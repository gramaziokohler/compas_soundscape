"""User-defined acoustic materials: row ↔ API shape, and inlining into simulations.

Custom material ids (``user_<hex>``) are unknown to the pyroomacoustics database
and to the worker processes. Before a simulation is enqueued, the router swaps
every custom id in ``object_materials`` for a coefficient dict
``{"id", "coeffs", "center_freqs"}`` taken from the request's ``custom_materials``
field. The solvers already accept such dicts (``pffdtd_scene_export.resolve_material``,
``pyroomacoustics_room_builder._absorption_bands``), so workers never read SQLite.

The definitions come from the client (its library, or the soundscape snapshot
of a shared workspace) and are validated with ``CustomMaterialCoefficients``.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from config.constants import CUSTOM_MATERIAL_CATEGORY, CUSTOM_MATERIAL_ID_PREFIX
from models.schemas import CustomMaterial, CustomMaterialCoefficients


def is_custom_material_id(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(CUSTOM_MATERIAL_ID_PREFIX)


def to_api(row: dict) -> CustomMaterial:
    """SQLite ``user_materials`` row → API material (mean absorption included)."""
    coeffs = json.loads(row["coeffs_json"])
    return CustomMaterial(
        id=row["id"],
        name=row["name"],
        description=row.get("description") or "",
        coeffs=coeffs,
        center_freqs=json.loads(row["center_freqs_json"]),
        absorption=sum(coeffs) / len(coeffs),
        category=CUSTOM_MATERIAL_CATEGORY,
        created_at=row.get("created_at") or "",
        updated_at=row.get("updated_at") or "",
    )


def parse_custom_materials(custom_json: str | None) -> dict[str, CustomMaterialCoefficients]:
    """Parse + validate the ``custom_materials`` form field ``{id: {coeffs, center_freqs}}``."""
    if not custom_json:
        return {}
    try:
        raw = json.loads(custom_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"custom_materials is not valid JSON: {exc}")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="custom_materials must be an object keyed by material id")
    parsed: dict[str, CustomMaterialCoefficients] = {}
    for material_id, value in raw.items():
        try:
            parsed[material_id] = CustomMaterialCoefficients.model_validate(value)
        except ValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid custom material '{material_id}': {exc.errors()[0]['msg']}",
            )
    return parsed


def inline_custom_materials(object_materials: dict, custom_json: str | None) -> dict:
    """Return ``object_materials`` with custom ids replaced by coefficient dicts."""
    definitions = parse_custom_materials(custom_json)
    resolved: dict = {}
    for object_id, material_id in object_materials.items():
        if not is_custom_material_id(material_id):
            resolved[object_id] = material_id
            continue
        definition = definitions.get(material_id)
        if definition is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown custom material '{material_id}' — it may have been deleted. "
                       "Reassign the affected surfaces and try again.",
            )
        resolved[object_id] = {"id": material_id, **definition.model_dump()}
    return resolved
