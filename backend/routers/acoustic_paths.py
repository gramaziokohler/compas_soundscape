"""
Sound-path endpoints for the 3D view (compas_acoustics engine).

POST /acoustics/paths-speckle
  Same geometry inputs as the run endpoints plus the ``kinds`` to compute
  ("reflections", "rays", "diffraction"). Enqueues a CPU job (variant
  "acoustic_paths") that prepares the same mesh as the simulation and traces
  the paths (services/acoustic_paths_service.py). Returns {job_id, position,
  total}; poll GET /api/jobs/{job_id}.

GET /acoustics/paths/{paths_id}
  The paths document written by the job, scoped to the caller's workspace.

GET /acoustics/engines
  Which geometric engine is the default and what it can do, so the simulation
  card only offers what will run.
"""
from __future__ import annotations

import importlib.util
import json
import re
import uuid
from pathlib import Path
from typing import Optional

from config.constants import (
    ACOUSTIC_PATHS_DIR,
    ACOUSTIC_PATHS_KINDS,
    ACOUSTIC_PATHS_MAX_EXCLUDED_EDGES,
    ACOUSTIC_PATHS_RAY_ORDER_DEFAULT,
    ACOUSTIC_PATHS_RAY_ORDER_MAX,
    ACOUSTIC_PATHS_RAYS_DEFAULT,
    ACOUSTIC_PATHS_RAYS_MAX,
    ACOUSTIC_PATHS_REFLECTION_ORDER_MAX,
    ACOUSTICS_ENGINE_COMPAS_ACOUSTICS,
    ACOUSTICS_ENGINE_DEFAULT,
    ACOUSTICS_ENGINE_PYROOMACOUSTICS,
    CA_AMBISONIC_ORDER_MAX,
    CA_DIFFRACTION_MODELS,
    CA_TAILS,
    JOB_TYPE_PYROOMACOUSTICS,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
)
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse
from models.schemas import JobEnqueueResponse
from services.acoustic_paths_service import paths_payload_path
from services.custom_materials_service import inline_custom_materials
from services.directivity_service import attach_directivity_specs
from services.job_store import job_store
from utils.request_parsing import parse_mesh_settings, parse_source_receiver_pairs

router = APIRouter(prefix="/api")

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9_-]")


def _workspace_dir(req: Request) -> Path:
    session_id = getattr(getattr(req, "state", None), "session_id", None) or "anonymous"
    return Path(ACOUSTIC_PATHS_DIR) / _SAFE_SEGMENT.sub("_", str(session_id))


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


@router.get("/acoustics/engines")
async def get_engines():
    installed = importlib.util.find_spec("compas_acoustics") is not None
    hybrid = installed and importlib.util.find_spec("pyFDN") is not None
    return {
        "default": ACOUSTICS_ENGINE_DEFAULT,
        "engines": {
            ACOUSTICS_ENGINE_COMPAS_ACOUSTICS: {
                "available": installed,
                "modes": ["mono", "foa", "hoa"] if hybrid else ["mono"],
                "diffraction": [m for m in CA_DIFFRACTION_MODELS if hybrid or m != "btms"],
                "tails": list(CA_TAILS),
                "max_ambisonic_order": CA_AMBISONIC_ORDER_MAX,
                "paths": list(ACOUSTIC_PATHS_KINDS),
            },
            ACOUSTICS_ENGINE_PYROOMACOUSTICS: {
                "available": True, "modes": ["mono", "foa"], "diffraction": ["off"], "tails": [],
                "max_ambisonic_order": 1, "paths": [],
            },
        },
    }


@router.post("/acoustics/paths-speckle", response_model=JobEnqueueResponse)
async def paths_speckle(
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
    kinds: str = Form('["reflections","diffraction"]'),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    n_rays: int = Form(ACOUSTIC_PATHS_RAYS_DEFAULT),
    ray_order: int = Form(ACOUSTIC_PATHS_RAY_ORDER_DEFAULT),
    excluded_edges: Optional[str] = Form(None),
):
    if importlib.util.find_spec("compas_acoustics") is None:
        raise HTTPException(status_code=501, detail="Sound paths need the compas_acoustics engine, which is not installed")
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    user_hash = getattr(getattr(req, "state", None), "user_hash", None)
    pairs = attach_directivity_specs(parse_source_receiver_pairs(source_receiver_pairs), user_hash, session_id, model_id)
    try:
        materials = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        scattering = json.loads(object_scattering) if object_scattering else {}
        kind_list = json.loads(kinds)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}")
    if not materials:
        raise HTTPException(status_code=400, detail="Assign materials first")
    if not isinstance(kind_list, list) or not kind_list or any(k not in ACOUSTIC_PATHS_KINDS for k in kind_list):
        raise HTTPException(status_code=400, detail=f"kinds must be a non-empty list of {list(ACOUSTIC_PATHS_KINDS)}")
    if not 0 <= max_order <= ACOUSTIC_PATHS_REFLECTION_ORDER_MAX:
        raise HTTPException(status_code=400, detail=f"max_order must be 0 to {ACOUSTIC_PATHS_REFLECTION_ORDER_MAX}")
    if not 1 <= n_rays <= ACOUSTIC_PATHS_RAYS_MAX:
        raise HTTPException(status_code=400, detail=f"n_rays must be 1 to {ACOUSTIC_PATHS_RAYS_MAX}")
    if not 0 <= ray_order <= ACOUSTIC_PATHS_RAY_ORDER_MAX:
        raise HTTPException(status_code=400, detail=f"ray_order must be 0 to {ACOUSTIC_PATHS_RAY_ORDER_MAX}")

    paths_id = str(uuid.uuid4())
    payload = {
        "variant": "acoustic_paths",
        "kwargs": dict(
            paths_id=paths_id,
            speckle_project_id=speckle_project_id,
            speckle_version_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
            object_materials_dict=inline_custom_materials(materials, custom_materials),
            object_scattering_dict=scattering,
            pairs_data=pairs,
            mesh_settings=parse_mesh_settings(mesh_settings).model_dump(),
            payload_dir=str(_workspace_dir(req)),
            kinds=kind_list,
            max_order=max_order,
            n_rays=n_rays,
            ray_order=ray_order,
            excluded_edges=parse_excluded_edges(excluded_edges),
        ),
    }
    job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, session_id, payload)
    view = await job_store.get(job_id)
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


@router.get("/acoustics/paths/{paths_id}")
async def get_paths(paths_id: str, req: Request):
    try:
        uuid.UUID(paths_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid paths id")
    path = paths_payload_path(str(_workspace_dir(req)), paths_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sound paths not found (expired or another workspace)")
    return FileResponse(path=str(path), media_type="application/json")
