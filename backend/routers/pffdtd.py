"""
PFFDTD (GPU finite-difference wave solver) simulation endpoints.

POST /api/pffdtd/run-simulation-speckle
  Same geometry inputs as pyroomacoustics plus the grid settings (fmax, points per
  wavelength, IR duration). Enqueues a "pffdtd" job (queue:pffdtd, worker role
  `pffdtd`) and returns {job_id, position, total}; poll GET /api/jobs/{job_id}.
GET /api/pffdtd/materials            -- same absorption database as pyroomacoustics
GET /api/pffdtd/get-result-file/...  -- results JSON / IR WAV (float32, 48 kHz)

Results are band-limited to fmax. Axis-aligned walls are exact on the grid; oblique
walls are staircased (first-order modal shift) -- see pffdtd_backend/validation/REPORT.md.
"""

from __future__ import annotations

import json
import traceback
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse

from config.constants import (
    JOB_TYPE_PFFDTD,
    PFFDTD_DEFAULT_AIR_ABSORPTION,
    PFFDTD_DEFAULT_DURATION,
    PFFDTD_DEFAULT_FMAX,
    PFFDTD_DEFAULT_PPW,
    PFFDTD_DURATION_MAX,
    PFFDTD_DURATION_MIN,
    PFFDTD_FMAX_MAX,
    PFFDTD_FMAX_MIN,
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
from services.job_store import job_store
from services.pffdtd_job import pffdtd_available
from services.pyroomacoustics_service import PyroomacousticsService
from utils.request_parsing import parse_mesh_settings

router = APIRouter(prefix="/api")

Path(PFFDTD_RIR_DIR).mkdir(parents=True, exist_ok=True)
Path(PFFDTD_TEMP_DIR).mkdir(parents=True, exist_ok=True)
Path(TEMP_SIMULATIONS_DIR).mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
RIR_OUTPUT_DIR = Path(PFFDTD_RIR_DIR)
FILE_PREFIX = "pffdtd_"


def _check_range(name: str, value: float, lo: float, hi: float) -> None:
    if not (lo <= value <= hi):
        raise HTTPException(status_code=400, detail=f"{name} must be between {lo:g} and {hi:g}")


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
async def get_result_file(simulation_id: str, file_type: str, ir_filename: Optional[str] = None):
    if file_type not in ("wav", "json"):
        raise HTTPException(status_code=400, detail="file_type must be 'wav' or 'json'")
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
):
    """Validate and enqueue; Speckle fetch, voxelisation and the GPU solve run in the worker."""
    reason = pffdtd_available()
    if reason:
        raise HTTPException(status_code=503, detail=f"PFFDTD is not available: {reason}")
    if simulation_mode not in (PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA):
        raise HTTPException(status_code=400, detail=f"Invalid simulation mode: {simulation_mode}")
    _check_range("fmax", fmax, PFFDTD_FMAX_MIN, PFFDTD_FMAX_MAX)
    _check_range("ppw", ppw, PFFDTD_PPW_MIN, PFFDTD_PPW_MAX)
    _check_range("duration", duration, PFFDTD_DURATION_MIN, PFFDTD_DURATION_MAX)

    simulation_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    try:
        pairs_data = json.loads(source_receiver_pairs)
        object_materials_dict = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}")
    if not pairs_data:
        raise HTTPException(status_code=400, detail="No source-receiver pairs provided")
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
