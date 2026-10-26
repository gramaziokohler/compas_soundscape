"""
PFFDTD (GPU finite-difference wave solver) simulation endpoints.

POST /api/pffdtd/run-simulation-speckle
  Same geometry inputs as pyroomacoustics plus the grid settings (fmax, points per
  wavelength, IR duration). Enqueues a "pffdtd" job (queue:pffdtd, worker role
  `pffdtd`) and returns {job_id, position, total}; poll GET /api/jobs/{job_id}.
GET /api/pffdtd/materials            -- same absorption database as pyroomacoustics
GET /api/pffdtd/get-result-file/...  -- results JSON / IR WAV (float32, 48 kHz) / field binaries
POST /api/pffdtd/animation            -- GPU job: wave animation of a finished run on a plane at z
POST /api/pffdtd/voxel-preview        -- CPU job: voxelise only and check the grid (no GPU)
GET /api/pffdtd/voxel-preview/{id}[/points]  -- preview payload (JSON) / boundary nodes (binary)

Results are band-limited to fmax. Axis-aligned walls are exact on the grid; oblique
walls use conformal cut cells (2nd order) -- see pffdtd_backend/validation/REPORT.md.
"""

from __future__ import annotations

import json
import re
import traceback
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse

from config.constants import (
    JOB_TYPE_PFFDTD,
    JOB_TYPE_PFFDTD_ANIMATION,
    JOB_TYPE_PYROOMACOUSTICS,
    PFFDTD_ANIMATION_MS_MAX,
    PFFDTD_ANIMATION_MS_MIN,
    PFFDTD_DEFAULT_AIR_ABSORPTION,
    PFFDTD_DEFAULT_ANIMATION_MS,
    PFFDTD_DEFAULT_DURATION,
    PFFDTD_DEFAULT_FMAX,
    PFFDTD_DEFAULT_PPW,
    PFFDTD_DURATION_MAX,
    PFFDTD_DURATION_MIN,
    PFFDTD_FIELD_DIR,
    PFFDTD_FMAX_MAX,
    PFFDTD_FMAX_MIN,
    PFFDTD_DEFAULT_FREE_MODE,
    PFFDTD_FREE_GRID_SPACING_DEFAULT,
    PFFDTD_FREE_GRID_SPACING_MAX,
    PFFDTD_FREE_GRID_SPACING_MIN,
    PFFDTD_FREE_MODES,
    PFFDTD_PPW_MAX,
    PFFDTD_PPW_MIN,
    PFFDTD_RIR_DIR,
    PFFDTD_TEMP_DIR,
    PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    TEMP_SIMULATIONS_DIR,
)
from models.schemas import JobEnqueueResponse
from routers.pyroomacoustics import get_materials as get_pyroomacoustics_materials
from routers.simulation_preflight import _workspace_dir
from services.job_store import job_store
from services.pffdtd_job import pffdtd_available
from services.pffdtd_preview_job import preview_paths
from services.pyroomacoustics_service import PyroomacousticsService
from utils.request_parsing import parse_mesh_settings

router = APIRouter(prefix="/api")

Path(PFFDTD_RIR_DIR).mkdir(parents=True, exist_ok=True)
Path(PFFDTD_TEMP_DIR).mkdir(parents=True, exist_ok=True)
Path(PFFDTD_FIELD_DIR).mkdir(parents=True, exist_ok=True)
Path(TEMP_SIMULATIONS_DIR).mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
RIR_OUTPUT_DIR = Path(PFFDTD_RIR_DIR)
FIELD_DIR = Path(PFFDTD_FIELD_DIR)
FILE_PREFIX = "pffdtd_"
FIELD_FILE_SUFFIXES = (".f32", ".i8", ".u8")
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _check_range(name: str, value: float, lo: float, hi: float) -> None:
    if not (lo <= value <= hi):
        raise HTTPException(status_code=400, detail=f"{name} must be between {lo:g} and {hi:g}")


def _require_available() -> None:
    reason = pffdtd_available()
    if reason:
        raise HTTPException(status_code=503, detail=f"PFFDTD is not available: {reason}")


def _parse_geometry_fields(source_receiver_pairs: str, object_materials: str, geometry_object_ids: Optional[str]):
    try:
        pairs_data = json.loads(source_receiver_pairs)
        object_materials_dict = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}")
    if not pairs_data:
        raise HTTPException(status_code=400, detail="No source-receiver pairs provided")
    return pairs_data, object_materials_dict, object_ids_filter


@router.get("/pffdtd/materials")
async def get_materials():
    """Absorption database (shared with pyroomacoustics; fitted to admittances in the solver)."""
    return await get_pyroomacoustics_materials()


@router.get("/pffdtd/status")
async def get_status():
    """Whether this deployment can run PFFDTD (env + built engine); the worker must also be up."""
    reason = pffdtd_available()
    return {"available": reason is None, "reason": reason}


@router.get("/pffdtd/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(
    simulation_id: str, file_type: str, ir_filename: Optional[str] = None, name: Optional[str] = None,
):
    """json / wav (``ir_filename``) / field: a plane or volume binary named in the results JSON ``field`` block."""
    if file_type not in ("wav", "json", "field"):
        raise HTTPException(status_code=400, detail="file_type must be 'wav', 'json' or 'field'")
    if file_type == "field":
        if (not name or not _SAFE_NAME.match(name) or not name.startswith(f"{FILE_PREFIX}{simulation_id}_")
                or not name.endswith(FIELD_FILE_SUFFIXES)):
            raise HTTPException(status_code=400, detail="Invalid field file name for this simulation")
        file_path = FIELD_DIR / name
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Field data not found (expired); re-run the simulation")
        return FileResponse(path=str(file_path), media_type="application/octet-stream", filename=name)
    if file_type == "json":
        filename = f"{FILE_PREFIX}{simulation_id}_results.json"
        file_path = TEMP_DIR / filename
        media_type = "application/json"
    else:
        if ir_filename:
            if not ir_filename.startswith(f"{FILE_PREFIX}{simulation_id}_") or "/" in ir_filename or "\\" in ir_filename:
                raise HTTPException(status_code=400, detail="Invalid IR filename for this simulation")
            file_path = RIR_OUTPUT_DIR / ir_filename
        else:
            matches = sorted(RIR_OUTPUT_DIR.glob(f"{FILE_PREFIX}{simulation_id}_*.wav"))
            if not matches:
                raise HTTPException(status_code=404, detail=f"No WAV files for simulation {simulation_id}")
            file_path = matches[0]
        filename = file_path.name
        media_type = "audio/wav"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)


@router.post("/pffdtd/run-simulation-speckle", response_model=JobEnqueueResponse)
async def run_simulation_speckle(
    req: Request,
    simulation_name: str = Form(...),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),               # JSON: {"objectId": "materialId"}
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),  # JSON: ["id1", ...]
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),
    fmax: float = Form(PFFDTD_DEFAULT_FMAX),
    ppw: float = Form(PFFDTD_DEFAULT_PPW),
    duration: float = Form(PFFDTD_DEFAULT_DURATION),
    air_absorption: bool = Form(PFFDTD_DEFAULT_AIR_ABSORPTION),
    source_receiver_pairs: str = Form(...),
    mesh_settings: Optional[str] = Form(None),
    field_plane_z: Optional[float] = Form(None),      # default plane height; default = mean listener z
    free_mode: str = Form(PFFDTD_DEFAULT_FREE_MODE),  # off | listener | source (routers/pffdtd_free.py)
    free_grid_spacing: float = Form(PFFDTD_FREE_GRID_SPACING_DEFAULT),
):
    """Validate and enqueue; Speckle fetch, voxelisation and the GPU solve run in the worker."""
    _require_available()
    if simulation_mode not in (PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA):
        raise HTTPException(status_code=400, detail=f"Invalid simulation mode: {simulation_mode}")
    _check_range("fmax", fmax, PFFDTD_FMAX_MIN, PFFDTD_FMAX_MAX)
    _check_range("ppw", ppw, PFFDTD_PPW_MIN, PFFDTD_PPW_MAX)
    _check_range("duration", duration, PFFDTD_DURATION_MIN, PFFDTD_DURATION_MAX)
    if free_mode not in PFFDTD_FREE_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid free_mode: {free_mode}")
    _check_range("free_grid_spacing", free_grid_spacing, PFFDTD_FREE_GRID_SPACING_MIN, PFFDTD_FREE_GRID_SPACING_MAX)

    simulation_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    pairs_data, object_materials_dict, object_ids_filter = _parse_geometry_fields(
        source_receiver_pairs, object_materials, geometry_object_ids,
    )
    mesh_prep = parse_mesh_settings(mesh_settings)

    try:
        PyroomacousticsService.validate_unit_scale(
            source_positions=[p["source_position"] for p in pairs_data],
            receiver_positions=[p["receiver_position"] for p in pairs_data],
        )
        payload = {
            "kwargs": dict(
                simulation_id=simulation_id,
                speckle_project_id=speckle_project_id,
                speckle_version_id=speckle_version_id,
                layer_name=layer_name,
                object_ids_filter=object_ids_filter,
                object_materials_dict=object_materials_dict,
                pairs_data=pairs_data,
                simulation_mode=simulation_mode,
                fmax=fmax,
                ppw=ppw,
                duration=duration,
                air_absorption=air_absorption,
                simulation_name=simulation_name,
                rir_output_dir=str(RIR_OUTPUT_DIR),
                temp_dir=str(TEMP_DIR),
                mesh_settings=mesh_prep.model_dump(),
                field_plane_z=field_plane_z,
                free_mode=free_mode,
                free_grid_spacing=free_grid_spacing,
            ),
        }
        job_id = await job_store.enqueue(JOB_TYPE_PFFDTD, session_id, payload)
        view = await job_store.get(job_id)
        print(f"PFFDTD simulation {job_id} queued at position {view.position} of {view.total}")
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"PFFDTD setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"PFFDTD simulation setup failed: {exc}")


@router.post("/pffdtd/animation", response_model=JobEnqueueResponse)
async def generate_animation(
    req: Request,
    simulation_id: str = Form(...),
    plane_z: float = Form(...),                       # height of the horizontal plane (m)
    animation_ms: float = Form(PFFDTD_DEFAULT_ANIMATION_MS),
):
    """Enqueue a wave animation of a finished run (pulse runs on its kept voxelisation, GPU queue).

    On completion the results JSON ``field`` block describes the new plane and its frames.
    """
    _require_available()
    try:
        uuid.UUID(simulation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid simulation id")
    _check_range("animation_ms", animation_ms, PFFDTD_ANIMATION_MS_MIN, PFFDTD_ANIMATION_MS_MAX)
    if not (TEMP_DIR / f"{FILE_PREFIX}{simulation_id}_results.json").exists():
        raise HTTPException(status_code=404, detail="Simulation results not found (expired); re-run the simulation")
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    payload = {
        "kwargs": dict(simulation_id=simulation_id, plane_z=plane_z, animation_ms=animation_ms, temp_dir=str(TEMP_DIR)),
    }
    job_id = await job_store.enqueue(JOB_TYPE_PFFDTD_ANIMATION, session_id, payload)
    view = await job_store.get(job_id)
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


@router.post("/pffdtd/voxel-preview", response_model=JobEnqueueResponse)
async def voxel_preview(
    req: Request,
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),
    source_receiver_pairs: str = Form(...),
    mesh_settings: Optional[str] = Form(None),
    fmax: float = Form(PFFDTD_DEFAULT_FMAX),
    ppw: float = Form(PFFDTD_DEFAULT_PPW),
):
    """Enqueue a voxelise-only CPU job (same queue and contract as the geometry preflight)."""
    _require_available()
    _check_range("fmax", fmax, PFFDTD_FMAX_MIN, PFFDTD_FMAX_MAX)
    _check_range("ppw", ppw, PFFDTD_PPW_MIN, PFFDTD_PPW_MAX)
    pairs_data, object_materials_dict, object_ids_filter = _parse_geometry_fields(
        source_receiver_pairs, object_materials, geometry_object_ids,
    )
    if not object_materials_dict:
        raise HTTPException(status_code=400, detail="Assign materials first")
    preview_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    payload = {
        "variant": "pffdtd_voxel_preview",
        "kwargs": dict(
            preview_id=preview_id,
            speckle_project_id=speckle_project_id,
            speckle_version_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
            object_materials_dict=object_materials_dict,
            pairs_data=pairs_data,
            fmax=fmax,
            ppw=ppw,
            payload_dir=str(_workspace_dir(req)),
            mesh_settings=parse_mesh_settings(mesh_settings).model_dump(),
        ),
    }
    job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, session_id, payload)
    view = await job_store.get(job_id)
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


def _preview_file(req: Request, preview_id: str, binary: bool) -> Path:
    try:
        uuid.UUID(preview_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid preview id")
    json_path, bin_path = preview_paths(str(_workspace_dir(req)), preview_id)
    path = bin_path if binary else json_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Voxel preview not found (expired or another workspace)")
    return path


@router.get("/pffdtd/voxel-preview/{preview_id}")
async def get_voxel_preview(preview_id: str, req: Request):
    return FileResponse(path=str(_preview_file(req, preview_id, False)), media_type="application/json")


@router.get("/pffdtd/voxel-preview/{preview_id}/points")
async def get_voxel_preview_points(preview_id: str, req: Request):
    return FileResponse(path=str(_preview_file(req, preview_id, True)), media_type="application/octet-stream")
