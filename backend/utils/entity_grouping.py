"""Stateless helpers that collapse 3D-model entities into groups for LLM prompts.

The model-analysis LLM used to receive one line per Speckle entity and had to echo
every 32-hex ID back in its answer, so prompt *and* output scaled with entity
count (10k ceiling tiles → 10+ minutes). Here identical entities are collapsed
into groups ``G1, G2, …``; the LLM answers with group keys and the backend expands
them back to the full Speckle ID list via ``group_map``.

Also hosts ``compact_furniture_for_prompt``: downstream agents (scenarist, foley,
speech) get a few sample IDs per analysed object instead of thousands.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

# ── Entity records ────────────────────────────────────────────────────────────

Vec3 = tuple[float, float, float]


@dataclass
class EntityRecord:
    """Prompt-relevant view of one Speckle entity (built by LLMService._prepare_entities)."""
    id: str
    layer: str = ""
    name: str = ""
    material: str = ""
    bbox: tuple[Vec3, Vec3] | None = None


@dataclass
class _Group:
    key: tuple
    ids: list[str] = field(default_factory=list)
    count: int = 0
    names: Counter = field(default_factory=Counter)
    materials: Counter = field(default_factory=Counter)
    example: EntityRecord | None = None
    ext_min: list[float] | None = None
    ext_max: list[float] | None = None


# Coarsening ladder: (signature fields, min member count for an Example line).
# None = no Example lines at all. Applied in order until the prompt fits.
_LEVELS: list[tuple[tuple[str, ...], int | None]] = [
    (("layer", "name", "material", "size"), 2),
    (("layer", "name", "material"), 2),
    (("layer", "name", "material"), 3),
    (("layer", "name"), 3),
    (("layer", "name"), None),
    (("layer",), None),
]

_TRAILING_INDEX = re.compile(r"[\s_\-#.:()]*(?:\d+|[0-9a-f]{8,})\)?$", re.IGNORECASE)


def normalize_name(name: str) -> str:
    """Lowercase and strip trailing indices / GUID-ish suffixes ("Chair 12" → "chair")."""
    base = (name or "").strip().lower()
    prev = None
    while base and base != prev:
        prev = base
        base = _TRAILING_INDEX.sub("", base).strip()
    return base or (name or "").strip().lower()


def _size(rec: EntityRecord, step: float) -> tuple[float, float, float] | None:
    if not rec.bbox:
        return None
    mn, mx = rec.bbox
    return tuple(round(abs(mx[i] - mn[i]) / step) * step for i in range(3))  # type: ignore[return-value]


def _owner_indices(records: list[EntityRecord]) -> list[int]:
    """Map each entity to the record whose group it joins.

    Rhino Breps arrive as a bbox-less parent immediately followed (depth-first
    order) by their display Mesh(es) carrying the bbox. A bbox-less entity joins
    the next bbox'd entity on the same layer, so each Brep+Mesh pair counts once.
    """
    owners = list(range(len(records)))
    for i, rec in enumerate(records):
        if rec.bbox is not None:
            continue
        for j in range(i + 1, len(records)):
            nxt = records[j]
            if nxt.layer != rec.layer:
                break
            if nxt.bbox is not None:
                owners[i] = j
                break
    return owners


def _build_groups(
    records: list[EntityRecord],
    owners: list[int],
    fields: tuple[str, ...],
    size_step: float,
) -> list[_Group]:
    groups: dict[tuple, _Group] = {}
    order: list[tuple] = []

    def key_of(rec: EntityRecord) -> tuple:
        parts: list = []
        for f in fields:
            if f == "layer":
                parts.append(rec.layer)
            elif f == "name":
                parts.append(normalize_name(rec.name))
            elif f == "material":
                parts.append(rec.material)
            elif f == "size":
                parts.append(_size(rec, size_step))
        return tuple(parts)

    for i, rec in enumerate(records):
        owner = records[owners[i]]
        key = key_of(owner)
        g = groups.get(key)
        if g is None:
            g = groups[key] = _Group(key=key)
            order.append(key)
        g.ids.append(rec.id)
        if owners[i] != i:
            continue  # attached Brep: keep its ID, don't count it as an extra object
        g.count += 1
        g.names[rec.name] += 1
        if rec.material:
            g.materials[rec.material] += 1
        if rec.bbox is not None:
            if g.example is None or g.example.bbox is None:
                g.example = rec
            mn, mx = rec.bbox
            if g.ext_min is None or g.ext_max is None:
                g.ext_min, g.ext_max = list(mn), list(mx)
            else:
                for k in range(3):
                    g.ext_min[k] = min(g.ext_min[k], mn[k])
                    g.ext_max[k] = max(g.ext_max[k], mx[k])
        elif g.example is None:
            g.example = rec
    return [groups[k] for k in order]


def _pt(p) -> str:
    return f"[{round(float(p[0]), 2)}, {round(float(p[1]), 2)}, {round(float(p[2]), 2)}]"


def _entity_line(rec: EntityRecord, with_layer: bool = True) -> str:
    line = f"SPECKLE_ID={rec.id}"
    if with_layer and rec.layer:
        line += f" | Layer={rec.layer}"
    if rec.name:
        line += f" | Name={rec.name}"
    if rec.material:
        line += f" | Material={rec.material}"
    if rec.bbox:
        line += f" | Position={_pt(rec.bbox[0])} to {_pt(rec.bbox[1])}"
    return line


def _group_lines(key: str, g: _Group, example_min: int | None, size_step: float) -> str:
    ex = g.example
    if g.count <= 1 and ex is not None:
        return f"[{key}] {_entity_line(ex)}"

    top_name, _ = g.names.most_common(1)[0] if g.names else ("", 0)
    line = f"[{key}] Count={g.count}"
    if ex is not None and ex.layer:
        line += f" | Layer={ex.layer}"
    if top_name:
        variants = len(g.names) - 1
        line += f" | Name={top_name}" + (f" (+{variants} name variants)" if variants else "")
    if g.materials:
        mats = [m for m, _ in g.materials.most_common(3)]
        line += f" | Material={mats[0]}" if len(g.materials) == 1 else f" | Materials={', '.join(mats)}"
    if ex is not None and ex.bbox is not None:
        sz = _size(ex, size_step) or (0.0, 0.0, 0.0)
        line += f" | Size={sz[0]:.2f}x{sz[1]:.2f}x{sz[2]:.2f}"
    if g.ext_min is not None and g.ext_max is not None:
        line += f" | Extent={_pt(g.ext_min)} to {_pt(g.ext_max)}"
    if example_min is not None and ex is not None and g.count >= example_min:
        line += f"\n    Example: {_entity_line(ex, with_layer=False)}"
    return line


def group_entities(
    records: list[EntityRecord],
    budget_chars: int,
    size_step: float,
) -> tuple[str, dict[str, list[str]], dict]:
    """Collapse entities into ``G<n>`` groups whose rendered text fits ``budget_chars``.

    Coarsens the group signature step by step (see ``_LEVELS``). If even the
    coarsest level overflows, the largest groups are kept and the rest are merged
    into one final "unclassified" group, so every Speckle ID stays in ``group_map``.

    Returns:
        (groups_text, group_map, stats)
        group_map: {"G1": [speckle_id, …], …}
        stats:     {"entities", "groups", "level", "truncated", "chars"}
    """
    owners = _owner_indices(records)
    text = ""
    group_map: dict[str, list[str]] = {}
    groups: list[_Group] = []
    example_min: int | None = None
    for level, (fields, example_min) in enumerate(_LEVELS):
        groups = _build_groups(records, owners, fields, size_step)
        lines = [_group_lines(f"G{i + 1}", g, example_min, size_step) for i, g in enumerate(groups)]
        text = "\n".join(lines)
        group_map = {f"G{i + 1}": list(dict.fromkeys(g.ids)) for i, g in enumerate(groups)}
        if len(text) <= budget_chars:
            return text, group_map, {
                "entities": len(records), "groups": len(groups),
                "level": level, "truncated": False, "chars": len(text),
            }

    # Still too large: keep the largest groups, merge the remainder.
    ranked = sorted(range(len(groups)), key=lambda i: -groups[i].count)
    reserve = 200  # room for the remainder line
    kept: list[int] = []
    used = 0
    for i in ranked:
        line = _group_lines("G0000", groups[i], example_min, size_step)
        if used + len(line) + 1 > budget_chars - reserve:
            continue
        kept.append(i)
        used += len(line) + 1
    kept.sort()  # restore model order
    kept_set = set(kept)

    lines = []
    group_map = {}
    for n, i in enumerate(kept):
        key = f"G{n + 1}"
        lines.append(_group_lines(key, groups[i], example_min, size_step))
        group_map[key] = list(dict.fromkeys(groups[i].ids))
    rest = [i for i in range(len(groups)) if i not in kept_set]
    if rest:
        key = f"G{len(kept) + 1}"
        rest_ids = [oid for i in rest for oid in groups[i].ids]
        rest_layers = Counter(groups[i].example.layer for i in rest if groups[i].example)
        layer_list = ", ".join(l or "(no layer)" for l, _ in rest_layers.most_common(5))
        lines.append(
            f"[{key}] Count={sum(groups[i].count for i in rest)} | Unclassified remainder "
            f"({len(rest)} small groups; layers: {layer_list})"
        )
        group_map[key] = list(dict.fromkeys(rest_ids))
    text = "\n".join(lines)
    return text, group_map, {
        "entities": len(records), "groups": len(group_map),
        "level": len(_LEVELS) - 1, "truncated": True, "chars": len(text),
    }


# ── Downstream prompt compaction ─────────────────────────────────────────────

def _compact_object(obj: dict, sample_n: int) -> dict:
    raw_ids = obj.get("object_ids")
    if isinstance(raw_ids, list):
        if len(raw_ids) <= sample_n:
            return obj
        return {**obj, "object_ids": raw_ids[:sample_n], "id_count": len(raw_ids)}
    if not isinstance(raw_ids, dict) or len(raw_ids) <= sample_n:
        return obj

    bounded = [k for k, v in raw_ids.items() if isinstance(v, dict) and v.get("min_bounds")]
    pool = bounded or list(raw_ids.keys())
    # Evenly spaced picks so the samples span the group spatially.
    step = max(1, len(pool) // sample_n)
    sample = pool[::step][:sample_n]

    ext_min: list[float] | None = None
    ext_max: list[float] | None = None
    for k in bounded:
        b = raw_ids[k]
        mn, mx = b.get("min_bounds") or [], b.get("max_bounds") or []
        if len(mn) < 3 or len(mx) < 3:
            continue
        if ext_min is None or ext_max is None:
            ext_min, ext_max = list(mn), list(mx)
        else:
            ext_min = [min(ext_min[i], mn[i]) for i in range(3)]
            ext_max = [max(ext_max[i], mx[i]) for i in range(3)]

    out = {
        **obj,
        "object_ids": {k: raw_ids[k] for k in sample},
        "id_count": len(raw_ids),
    }
    if ext_min is not None and ext_max is not None:
        out["extent"] = {"min_bounds": ext_min, "max_bounds": ext_max}
    return out


def compact_furniture_for_prompt(furniture_list: dict | None, sample_n: int) -> dict | None:
    """Return a copy of an analysis result with at most ``sample_n`` Speckle IDs per object.

    Sampled IDs are real member IDs (with bounds) so agents can still reference
    them; ``id_count`` and ``extent`` (union bbox) describe the whole object group.
    """
    if not furniture_list:
        return furniture_list
    out = dict(furniture_list)
    for key in ("architecturalObjects", "objects"):
        objs = out.get(key)
        if isinstance(objs, list):
            out[key] = [_compact_object(o, sample_n) if isinstance(o, dict) else o for o in objs]
    return out
