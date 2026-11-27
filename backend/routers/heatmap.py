"""
Heatmap endpoints for the Heatmap listener card (compas_acoustics EnergyMap).

POST /acoustics/heatmap-speckle
  Same Speckle geometry inputs as a simulation run plus ``points`` (JSON list of
  [x, y, z], model coordinates). Enqueues a CPU job (variant "heatmap") that
  prepares the same mesh as the simulation and maps every source at 0 dB
  (services/heatmap_service.py). Returns {job_id, position, total}; poll
  GET /api/jobs/{job_id}.

GET /acoustics/heatmap/{heatmap_id}
  The heatmap document written by the job, scoped to the caller's workspace.
"""
from __future__ import annotations

import importlib.util
import json
import math
import re
import uuid
from pathlib import Path
from typing import Optional

from config.constants import HEATMAP_DIR, HEATMAP_MAX_POINTS, JOB_TYPE_PYROOMACOUSTICS
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse
from models.schemas import JobEnqueueResponse
from services.custom_materials_service import inline_custom_materials
from services.directivity_service import attach_directivity_specs
from services.heatmap_service import heatmap_payload_path
from services.job_store import job_store
from utils.request_parsing import parse_mesh_settings, parse_source_receiver_pairs

router = APIRouter(prefix="/api")

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9_-]")


def _workspace_dir(req: Request) -> Path:
    session_id = getattr(getattr(req, "state", None), "session_id", None) or "anonymous"
    return Path(HEATMAP_DIR) / _SAFE_SEGMENT.sub("_", str(session_id))


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_heatmap_points(raw: str) -> list[list[float]]:
    """The ``points`` form field: a non-empty JSON list of at most HEATMAP_MAX_POINTS [x, y, z]."""
    try:
        rows = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid points JSON: {exc}")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="points must be a non-empty list of [x, y, z]")
    if len(rows) > HEATMAP_MAX_POINTS:
        raise HTTPException(status_code=400, detail=f"At most {HEATMAP_MAX_POINTS} heatmap points (got {len(rows)})")
    for row in rows:
        if not isinstance(row, list) or len(row) != 3 or not all(_is_number(v) for v in row):
            raise HTTPException(status_code=400, detail="Each heatmap point is [x, y, z] (finite numbers)")
    return [[float(v) for v in row] for row in rows]


@router.post("/acoustics/heatmap-speckle", response_model=JobEnqueueResponse)
async def heatmap_speckle(
    req: Request,
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),
    custom_materials: str = Form("{}"),
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),
    object_scattering: str = Form("{}"),
    source_receiver_pairs: str = Form(...),
    mesh_settings: Optional[str] = Form(None),
    model_id: Optional[str] = Form(None),
    points: str = Form(...),
):
    if importlib.util.find_spec("compas_acoustics") is None:
        raise HTTPException(status_code=501, detail="The heatmap needs the compas_acoustics engine, which is not installed")
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    user_hash = getattr(getattr(req, "state", None), "user_hash", None)
    try:
        materials = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        scattering = json.loads(object_scattering) if object_scattering else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}")
    if not materials:
        raise HTTPException(status_code=400, detail="Assign materials first")
    point_list = parse_heatmap_points(points)
    pairs = attach_directivity_specs(parse_source_receiver_pairs(source_receiver_pairs), user_hash, session_id, model_id)

    heatmap_id = str(uuid.uuid4())
    payload = {
        "variant": "heatmap",
        "kwargs": dict(
            heatmap_id=heatmap_id,
            speckle_project_id=speckle_project_id,
            speckle_version_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
            object_materials_dict=inline_custom_materials(materials, custom_materials),
            object_scattering_dict=scattering,
            pairs_data=pairs,
            points=point_list,
            mesh_settings=parse_mesh_settings(mesh_settings).model_dump(),
            payload_dir=str(_workspace_dir(req)),
        ),
    }
    job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, session_id, payload)
    view = await job_store.get(job_id)
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


@router.get("/acoustics/heatmap/{heatmap_id}")
async def get_heatmap(heatmap_id: str, req: Request):
    try:
        uuid.UUID(heatmap_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid heatmap id")
    path = heatmap_payload_path(str(_workspace_dir(req)), heatmap_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Heatmap not found (expired or another workspace)")
    return FileResponse(path=str(path), media_type="application/json")
