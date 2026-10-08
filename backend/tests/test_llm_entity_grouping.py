"""Tests for utils/entity_grouping.py (3D model analysis prompt grouping)."""
from __future__ import annotations

import re

from utils.entity_grouping import (
    EntityRecord,
    compact_furniture_for_prompt,
    group_entities,
    normalize_name,
)

STEP = 0.05
BIG_BUDGET = 1_000_000


def _hex(n: int) -> str:
    return f"{n:032x}"


def _office(n_tiles: int = 1000) -> list[EntityRecord]:
    """Ceiling Brep+display-Mesh pairs, 20 chairs, 3 tables (depth-first order)."""
    recs: list[EntityRecord] = []
    k = 0
    for i in range(n_tiles):
        x = 40 + (i % 50) * 0.3
        y = 100 + (i // 50) * 1.48
        recs.append(EntityRecord(_hex(k), "suspended ceiling", "Brep")); k += 1
        recs.append(EntityRecord(
            _hex(k), "suspended ceiling", "Mesh",
            bbox=((x, y, 15.79), (x + 0.3, y + 1.48, 15.79)),
        )); k += 1
    for i in range(20):
        recs.append(EntityRecord(
            _hex(k), "furniture", f"chairOffice {i}", "fabric",
            bbox=((i, 0, 0), (i + 0.6, 0.6, 1.0)),
        )); k += 1
    for i in range(3):
        recs.append(EntityRecord(
            _hex(k), "furniture", "TableBig", "oak",
            bbox=((i * 3, 5, 0), (i * 3 + 2.4, 6.2, 0.75)),
        )); k += 1
    return recs


def test_normalize_name_strips_indices():
    assert normalize_name("chairOffice 12") == "chairoffice"
    assert normalize_name("Chair_03") == "chair"
    assert normalize_name("Mesh") == "mesh"


def test_groups_collapse_tiles_and_keep_all_ids():
    recs = _office()
    text, group_map, stats = group_entities(recs, BIG_BUDGET, STEP)

    assert stats["groups"] == 3  # tiles, chairs, tables
    assert not stats["truncated"]
    all_ids = [i for ids in group_map.values() for i in ids]
    assert sorted(all_ids) == sorted(r.id for r in recs)

    tiles = max(group_map.values(), key=len)
    assert len(tiles) == 2000  # Brep + its display Mesh both kept
    assert "Count=1000" in text  # …but counted once per tile
    assert "Count=20" in text and "Count=3" in text


def test_multi_member_groups_have_one_example():
    text, group_map, _ = group_entities(_office(), BIG_BUDGET, STEP)
    lines = text.split("\n")
    headers = [l for l in lines if l.startswith("[G")]
    examples = [l for l in lines if l.strip().startswith("Example:")]
    assert len(headers) == len(group_map)
    assert len(examples) == 3
    assert all("SPECKLE_ID=" in e and "Position=" in e for e in examples)


def test_single_member_group_is_full_entity_line():
    recs = [EntityRecord(_hex(1), "furniture", "Piano", "lacquer", ((0, 0, 0), (1.5, 0.6, 1.2)))]
    text, group_map, _ = group_entities(recs, BIG_BUDGET, STEP)
    assert text.startswith("[G1] SPECKLE_ID=")
    assert "Count=" not in text and "Example" not in text
    assert group_map == {"G1": [_hex(1)]}


def test_budget_is_respected_and_no_id_is_lost():
    # 50k distinct-ish entities across many layers / names / sizes.
    recs = [
        EntityRecord(
            _hex(i), f"layer {i % 400}", f"part{i % 997}x", f"mat{i % 13}",
            bbox=((0, 0, 0), (0.1 + (i % 37) * 0.1, 0.2, 0.3)),
        )
        for i in range(50_000)
    ]
    budget = 20_000 * 4 - 3_000
    text, group_map, stats = group_entities(recs, budget, STEP)
    assert len(text) <= budget
    all_ids = {i for ids in group_map.values() for i in ids}
    assert len(all_ids) == 50_000
    keys_in_text = set(re.findall(r"^\[(G\d+)\]", text, re.MULTILINE))
    assert keys_in_text == set(group_map)


def test_compact_furniture_caps_ids_and_adds_extent():
    ids = {
        _hex(i): {"min_bounds": [i, 0, 0], "max_bounds": [i + 1, 1, 1]}
        for i in range(100)
    }
    furniture = {
        "architecturalObjects": [
            {"name": "Ceiling Tiles", "object_ids": ids},
            {"name": "Piano", "object_ids": {_hex(999): {}}},
        ],
        "meta": {"total_bounds": {}},
    }
    out = compact_furniture_for_prompt(furniture, 5)
    tiles, piano = out["architecturalObjects"]
    assert len(tiles["object_ids"]) == 5
    assert set(tiles["object_ids"]) <= set(ids)
    assert tiles["id_count"] == 100
    assert tiles["extent"] == {"min_bounds": [0, 0, 0], "max_bounds": [100, 1, 1]}
    assert piano == furniture["architecturalObjects"][1]
    # original untouched
    assert len(furniture["architecturalObjects"][0]["object_ids"]) == 100
