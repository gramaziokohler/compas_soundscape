# backend/utils/request_parsing.py
# Shared parsing of JSON form fields sent by the simulation endpoints.

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from models.schemas import MeshPrepSettings


def parse_mesh_settings(raw: Optional[str]) -> MeshPrepSettings:
    """Validate the ``mesh_settings`` JSON form field (400 on bad input)."""
    try:
        return MeshPrepSettings.from_form(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mesh_settings: {exc}")
