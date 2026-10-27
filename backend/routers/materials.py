"""
Per-user acoustic material library.

GET    /api/me/materials        The caller's custom materials
POST   /api/me/materials        Create one (7 octave-band absorption coefficients)
PUT    /api/me/materials/{id}   Update name / description / coefficients
DELETE /api/me/materials/{id}   Delete one

Materials are keyed by ``request.state.user_hash`` (they follow the user across
workspaces, like preferences) and stored in SQLite (services/metadata_store.py).
Simulations receive them inline — see services/custom_materials_service.py.
"""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException, Request

from config.constants import (
    CUSTOM_MATERIAL_CENTER_FREQS,
    CUSTOM_MATERIAL_ID_PREFIX,
    CUSTOM_MATERIALS_PER_USER_MAX,
)
from models.schemas import CustomMaterial, CustomMaterialInput
from services.custom_materials_service import to_api
from services.metadata_store import metadata_store

router = APIRouter(prefix="/api/me", tags=["materials"])


def _require_user(request: Request) -> str:
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        raise HTTPException(status_code=400, detail="No identity for this session")
    return user_hash


@router.get("/materials", response_model=list[CustomMaterial])
async def list_materials(request: Request) -> list[CustomMaterial]:
    user_hash = getattr(request.state, "user_hash", None)
    return [to_api(row) for row in metadata_store.list_user_materials(user_hash)]


@router.post("/materials", response_model=CustomMaterial, status_code=201)
async def create_material(payload: CustomMaterialInput, request: Request) -> CustomMaterial:
    user_hash = _require_user(request)
    if metadata_store.count_user_materials(user_hash) >= CUSTOM_MATERIALS_PER_USER_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"You can save at most {CUSTOM_MATERIALS_PER_USER_MAX} custom materials",
        )
    row = metadata_store.create_user_material(
        user_hash,
        f"{CUSTOM_MATERIAL_ID_PREFIX}{uuid.uuid4().hex}",
        payload.name,
        payload.description.strip(),
        json.dumps(payload.coeffs),
        json.dumps(CUSTOM_MATERIAL_CENTER_FREQS),
    )
    return to_api(row)


@router.put("/materials/{material_id}", response_model=CustomMaterial)
async def update_material(material_id: str, payload: CustomMaterialInput, request: Request) -> CustomMaterial:
    row = metadata_store.update_user_material(
        _require_user(request),
        material_id,
        payload.name,
        payload.description.strip(),
        json.dumps(payload.coeffs),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Material not found")
    return to_api(row)


@router.delete("/materials/{material_id}")
async def delete_material(material_id: str, request: Request) -> dict:
    if metadata_store.delete_user_material(_require_user(request), material_id) is None:
        raise HTTPException(status_code=404, detail="Material not found")
    return {"deleted": material_id}
