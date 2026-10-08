# backend/utils/geometry.py
# Stateless geometry helpers for the acoustic simulation pipeline.

import numpy as np

from typing import Any, Callable, Iterable, Optional


def canonical_object_id(obj_id) -> str:
    """
    Normalize a Speckle object id for cross-layer matching.

    Speckle's viewer WorldTree appends a ``#<n>`` suffix to disambiguate objects
    whose ``applicationId`` is duplicated within a model, so the frontend stores
    material/scattering assignments keyed by e.g. ``<hash>#3`` while the objects
    the backend receives carry the bare ``<hash>``/GUID. Stripping the suffix
    lets an assignment keyed by the viewer id resolve to the geometry object.

    Args:
        obj_id: Any object identifier (str, None, ...).

    Returns:
        The identifier without its ``#<n>`` suffix, stripped, or "" if empty.
    """
    if obj_id is None:
        return ""
    return str(obj_id).strip().split("#", 1)[0]


def resolve_object_id(obj_id, available_ids: Iterable[str]) -> Optional[str]:
    """
    Resolve a (possibly suffixed) object id to a key present in ``available_ids``.

    Tries, in order: exact match, base (``#`` stripped) match, then a
    case-insensitive base match. Returns the matching key from ``available_ids``
    or None when nothing matches.
    """
    if obj_id is None:
        return None
    if obj_id in available_ids:
        return obj_id
    base = canonical_object_id(obj_id)
    if not base:
        return None
    if base in available_ids:
        return base
    low = base.lower()
    for key in available_ids:
        if canonical_object_id(key).lower() == low:
            return key
    return None



def map_object_values_to_faces(
    values_by_object: dict,
    object_face_ranges: dict,
    cast: Optional[Callable[[Any], Any]] = None,
) -> tuple[dict[int, Any], int, int]:
    """
    Expand per-object values (material id, scattering...) to per-face values
    using the geometry's ``{object_id: [start_face, end_face]}`` ranges.

    Object ids are resolved with :func:`resolve_object_id` (viewer ``#n``
    suffixes, case). Returns ``(face_values, n_matched, n_skipped)``.
    """
    face_values: dict[int, Any] = {}
    matched = skipped = 0
    for obj_id, value in values_by_object.items():
        resolved = resolve_object_id(obj_id, object_face_ranges)
        if resolved is None:
            skipped += 1
            continue
        matched += 1
        start, end = object_face_ranges[resolved]
        v = cast(value) if cast else value
        for face_idx in range(int(start), int(end) + 1):
            face_values[face_idx] = v
    return face_values, matched, skipped


def seeds_from_pairs(pairs: list[dict]) -> list[dict]:
    """
    Unique sources then receivers of source/receiver pairs, in first-seen
    order: ``[{"id", "kind", "position"}]``. Used as the air seeds of the
    simulation mesh preparation.
    """
    seen: dict[tuple[str, str], dict] = {}
    for pair in pairs:
        for kind in ("source", "receiver"):
            key = (kind, str(pair[f"{kind}_id"]))
            if key not in seen:
                seen[key] = {"id": key[1], "kind": kind, "position": [float(x) for x in pair[f"{kind}_position"]]}
    sources = [v for (k, _), v in seen.items() if k == "source"]
    receivers = [v for (k, _), v in seen.items() if k == "receiver"]
    return sources + receivers

