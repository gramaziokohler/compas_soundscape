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
    PFFDTD_DEFAULT_DURATION,
    PFFDTD_DEFAULT_FMAX,
    PFFDTD_DEFAULT_PPW,
    PREFLIGHT_PAYLOAD_DIR,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
)
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse
from models.schemas import JobEnqueueResponse
from services.custom_materials_service import inline_custom_materials
from services.directivity_service import any_directional, attach_directivity_specs, directional_run_count
from services.job_store import job_store
from services.simulation_preflight_service import ENGINE_PFFDTD, ENGINE_PYROOMACOUSTICS, ENGINES
from services.simulation_preflight_worker import preflight_payload_path
from utils.request_parsing import parse_mesh_settings, parse_source_receiver_pairs

router = APIRouter(prefix="/api")

_ENGINES = ENGINES
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
    custom_materials: str = Form("{}"),
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),
    object_scattering: str = Form("{}"),
    source_receiver_pairs: str = Form(...),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    mesh_settings: Optional[str] = Form(None),
    fmax: float = Form(PFFDTD_DEFAULT_FMAX),          # PFFDTD only
    ppw: float = Form(PFFDTD_DEFAULT_PPW),            # PFFDTD only
    duration: float = Form(PFFDTD_DEFAULT_DURATION),  # PFFDTD only
    simulation_mode: str = Form("mono"),              # PFFDTD only: run count of directional sources
    free_mode: str = Form("off"),                     # PFFDTD only
    model_id: Optional[str] = Form(None),             # resolves shared-soundscape directivity copies
):
    if engine not in _ENGINES:
        raise HTTPException(status_code=400, detail=f"engine must be one of {_ENGINES}")
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    user_hash = getattr(getattr(req, "state", None), "user_hash", None)
    typed_pairs = parse_source_receiver_pairs(source_receiver_pairs)
    pairs = attach_directivity_specs(typed_pairs, user_hash, session_id, model_id)
    try:
        materials = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        scattering = json.loads(object_scattering) if object_scattering else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}")
    if not materials:
        raise HTTPException(status_code=400, detail="Assign materials first")
    materials = inline_custom_materials(materials, custom_materials)
    settings = parse_mesh_settings(mesh_settings)
    directional = engine == ENGINE_PFFDTD and any_directional(pairs)

    preflight_id = str(uuid.uuid4())
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
            pffdtd_settings=(
                {
                    "fmax": fmax, "ppw": ppw, "duration": duration,
                    # reciprocal runs of directional sources (services/directivity_service.py)
                    "runs": directional_run_count(pairs, simulation_mode) if directional else 0,
                    "directional_free_listener": directional and free_mode == "listener",
                }
                if engine == ENGINE_PFFDTD else None
            ),
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
