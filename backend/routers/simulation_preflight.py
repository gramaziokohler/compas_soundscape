"""
Simulation geometry preflight endpoints (engine-agnostic).

POST /simulation/preflight-speckle
  Same geometry inputs as the run endpoints (Speckle model, materials,
  source/receiver pairs, mesh settings) plus the target ``engine``. Enqueues a
  CPU job (variant "pyroomacoustics_preflight") that runs the SAME mesh
  preparation as the simulation and analyses it. Returns {job_id, position,
  total}; poll GET /api/jobs/{job_id}.

GET /simulation/preflight/{preflight_id}
  The preview payload (welded mesh + per-face flags + issues) written by the
  job, scoped to the caller's workspace.
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Optional

from config.constants import (
    JOB_TYPE_PYROOMACOUSTICS,
    PREFLIGHT_PAYLOAD_DIR,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
)
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse
from models.schemas import JobEnqueueResponse
from services.job_store import job_store
from services.simulation_preflight_service import ENGINE_CHORAS, ENGINE_PYROOMACOUSTICS
from services.simulation_preflight_worker import preflight_payload_path
from utils.request_parsing import parse_mesh_settings

router = APIRouter(prefix="/api")

_ENGINES = (ENGINE_PYROOMACOUSTICS, ENGINE_CHORAS)
_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9_-]")


def _workspace_dir(req: Request) -> Path:
    session_id = getattr(getattr(req, "state", None), "session_id", None) or "anonymous"
    return Path(PREFLIGHT_PAYLOAD_DIR) / _SAFE_SEGMENT.sub("_", str(session_id))


@router.post("/simulation/preflight-speckle", response_model=JobEnqueueResponse)
async def preflight_speckle(
    req: Request,
    engine: str = Form(ENGINE_PYROOMACOUSTICS),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),
    object_scattering: str = Form("{}"),
    source_receiver_pairs: str = Form(...),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    mesh_settings: Optional[str] = Form(None),
):
    if engine not in _ENGINES:
        raise HTTPException(status_code=400, detail=f"engine must be one of {_ENGINES}")
    try:
        pairs = json.loads(source_receiver_pairs)
        materials = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        scattering = json.loads(object_scattering) if object_scattering else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}")
    if not pairs:
        raise HTTPException(status_code=400, detail="No source-receiver pairs provided")
    if not materials:
        raise HTTPException(status_code=400, detail="Assign materials first")
    settings = parse_mesh_settings(mesh_settings)

    preflight_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    payload = {
        "variant": "pyroomacoustics_preflight",
        "kwargs": dict(
            preflight_id=preflight_id,
            engine=engine,
            speckle_project_id=speckle_project_id,
            speckle_version_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
            object_materials_dict=materials,
            object_scattering_dict=scattering,
            pairs_data=pairs,
            max_order=max_order,
            ray_tracing=ray_tracing,
            mesh_settings=settings.model_dump(),
            payload_dir=str(_workspace_dir(req)),
        ),
    }
    job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, session_id, payload)
    view = await job_store.get(job_id)
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


@router.get("/simulation/preflight/{preflight_id}")
async def get_preflight(preflight_id: str, req: Request):
    try:
        uuid.UUID(preflight_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid preflight id")
    path = preflight_payload_path(str(_workspace_dir(req)), preflight_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Preflight result not found (expired or another workspace)")
    return FileResponse(path=str(path), media_type="application/json")
