# backend/tests/test_acoustic_paths_filter.py
"""The paths document helpers (utils/acoustic_paths.py): a run's groups joined into one, and the share
view keeping only the shared listeners."""

from utils.acoustic_paths import filter_paths_receivers, merge_paths_docs


def _doc(sources, receivers, paths, diffracted=None, notes=()):
    doc = {
        "speed_of_sound": 343.0, "notes": list(notes),
        "sources": [{"id": s, "position": [0, 0, 0]} for s in sources],
        "receivers": [{"id": r, "position": [1, 0, 0]} for r in receivers],
        "reflections": {"max_order": 1, "paths": paths},
    }
    if diffracted is not None:
        doc["diffraction"] = {"paths": diffracted}
    return doc


def test_merge_joins_groups_by_id():
    a = _doc(["s1"], ["r1", "r2"], [{"s": 0, "r": 1, "order": 0, "delay_ms": 9.0}], notes=["n"])
    b = _doc(["s2", "s1"], ["r2"], [{"s": 0, "r": 0, "order": 1, "delay_ms": 3.0}], [{"s": 0, "r": 0, "delay_ms": 5.0}], notes=["n"])
    out = merge_paths_docs([a, b])
    assert [s["id"] for s in out["sources"]] == ["s1", "s2"]
    assert [r["id"] for r in out["receivers"]] == ["r1", "r2"]
    assert out["reflections"] == {"max_order": 1, "paths": [{"s": 1, "r": 1, "order": 1, "delay_ms": 3.0}, {"s": 0, "r": 1, "order": 0, "delay_ms": 9.0}]}
    assert out["diffraction"]["paths"] == [{"s": 1, "r": 1, "delay_ms": 5.0}]
    assert out["notes"] == ["n"]
    assert "diffraction" not in merge_paths_docs([a])


def test_filter_keeps_allowed_listeners_and_remaps():
    doc = {
        "sources": [{"id": "s1", "position": [0, 0, 0]}],
        "receivers": [{"id": "a", "position": [1, 0, 0]}, {"id": "b", "position": [2, 0, 0]}],
        "reflections": {"max_order": 1, "paths": [{"s": 0, "r": 0, "order": 0}, {"s": 0, "r": 1, "order": 1}]},
        "diffraction": {"paths": [{"s": 0, "r": 1, "zone": "shadow"}]},
        "notes": [],
    }
    out = filter_paths_receivers(doc, lambda rid: rid == "b")
    assert [r["id"] for r in out["receivers"]] == ["b"]
    assert out["reflections"]["paths"] == [{"s": 0, "r": 0, "order": 1}]
    assert out["diffraction"]["paths"] == [{"s": 0, "r": 0, "zone": "shadow"}]
    assert doc["receivers"][0]["id"] == "a"                        # the input is left alone
    assert filter_paths_receivers(None, lambda rid: True) is None
