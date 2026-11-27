# backend/utils/request_parsing.py
# Shared parsing of JSON form fields sent by the simulation endpoints.

from __future__ import annotations

import json
from typing import Optional

from fastapi import HTTPException
from pydantic import ValidationError

from config.constants import ACOUSTIC_PATHS_MAX_EXCLUDED_EDGES
from models.schemas import MeshPrepSettings, SourceReceiverPair


def parse_excluded_edges(raw: Optional[str]) -> list[list[float]]:
    """The ``excluded_edges`` form field: a JSON list of [x1, y1, z1, x2, y2, z2] (model coordinates)."""
    if not raw:
        return []
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid excluded_edges: {exc}")
    if not isinstance(rows, list) or len(rows) > ACOUSTIC_PATHS_MAX_EXCLUDED_EDGES:
        raise HTTPException(status_code=400, detail=f"excluded_edges must be a list of at most {ACOUSTIC_PATHS_MAX_EXCLUDED_EDGES} edges")
    out = []
    for row in rows:
        if not isinstance(row, list) or len(row) != 6 or not all(isinstance(v, (int, float)) for v in row):
            raise HTTPException(status_code=400, detail="Each excluded edge is [x1, y1, z1, x2, y2, z2]")
        out.append([float(v) for v in row])
    return out


def parse_mesh_settings(raw: Optional[str]) -> MeshPrepSettings:
    """Validate the ``mesh_settings`` JSON form field (400 on bad input)."""
    try:
        return MeshPrepSettings.from_form(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mesh_settings: {exc}")


def parse_source_receiver_pairs(raw: str) -> list[SourceReceiverPair]:
    """Validate the ``source_receiver_pairs`` JSON form field (400 on bad input, 400 when empty)."""
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid source_receiver_pairs JSON: {exc}")
    if not isinstance(data, list) or not data:
        raise HTTPException(status_code=400, detail="No source-receiver pairs provided")
    try:
        return [SourceReceiverPair.model_validate(p) for p in data]
    except ValidationError as exc:
        err = exc.errors()[0]
        loc = ".".join(str(x) for x in err.get("loc", ()))
        raise HTTPException(status_code=400, detail=f"Invalid source-receiver pair ({loc}): {err.get('msg')}")
