"""Stateless helpers for normalizing raw LLM analyze_3dmodel() output."""
from __future__ import annotations


def normalize_analysis_objects(raw: list) -> list[dict]:
    """Clamp and coerce raw object dicts from the LLM into consistent types.

    object_ids comes in as dict[str, dict] (already resolved with bounds by
    analyze_3dmodel) or as list[str] (legacy/fallback — converted to
    empty-bounds dicts).
    """
    out = []
    for obj in raw:
        if not isinstance(obj, dict):
            continue
        try:
            raw_oids = obj.get("object_ids", {})
            if isinstance(raw_oids, dict):
                object_ids: dict[str, dict] = {
                    str(k): v if isinstance(v, dict) else {}
                    for k, v in raw_oids.items()
                }
            else:
                object_ids = {str(x): {} for x in raw_oids}

            out.append({
                "name": str(obj.get("name", "Unknown")),
                "description": str(obj.get("description", "")),
                "material": str(obj.get("material", "")),
                "quantity": max(1, int(obj.get("quantity", 1))),
                "object_ids": object_ids,
            })
        except (ValueError, TypeError):
            continue
    return out
