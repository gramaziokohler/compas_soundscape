# backend/utils/request_parsing.py
# Shared parsing of JSON form fields sent by the simulation endpoints.

from __future__ import annotations

import json
from typing import Optional

from fastapi import HTTPException
from pydantic import ValidationError

from models.schemas import MeshPrepSettings, SourceReceiverPair


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
