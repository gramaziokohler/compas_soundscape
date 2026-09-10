"""
Choras (DE/DG) acoustic simulation endpoints.

POST /choras/run-simulation-speckle
  Validates basic params, enqueues a "choras" job on the Redis job store,
  returns {job_id, position, total} immediately. Speckle fetch, .geo
  generation, and the DE/DG solve all run in a worker child process
  (services/choras_job.py via workers/choras_runner.py) — a solver crash
  or cancel can no longer take the API process down with it.

Poll/cancel via GET/POST /api/jobs/{job_id}(/cancel) — see routers/jobs.py.
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Form, Request
from fastapi.responses import FileResponse

from services.choras_service import ChorasService
from services.job_store import job_store
from models.schemas import JobEnqueueResponse
from config.constants import (
    CHORAS_RIR_DIR,
    CHORAS_TEMP_DIR,
    CHORAS_DE_DEFAULT_C0,
    CHORAS_DE_DEFAULT_LC,
    CHORAS_DG_DEFAULT_C0,
    CHORAS_DG_DEFAULT_RHO0,
    CHORAS_DG_DEFAULT_FREQ_UPPER,
    CHORAS_DG_DEFAULT_POLY_ORDER,
    CHORAS_DG_DEFAULT_PPW,
    CHORAS_DG_DEFAULT_CFL,
    CHORAS_DEFAULT_FREQUENCIES,
    TEMP_SIMULATIONS_DIR,
    JOB_TYPE_CHORAS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# Ensure output directories exist at import time
Path(CHORAS_RIR_DIR).mkdir(parents=True, exist_ok=True)
Path(CHORAS_TEMP_DIR).mkdir(parents=True, exist_ok=True)
Path(TEMP_SIMULATIONS_DIR).mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
RIR_OUTPUT_DIR = Path(CHORAS_RIR_DIR)


# ─── Materials ────────────────────────────────────────────────────────────────

@router.get("/choras/materials")
async def get_choras_materials():
    """Return available absorption materials for Choras (DE/DG) simulations."""
    try:
        return ChorasService.get_material_database()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load materials: {exc}")


# ─── Result file serving ──────────────────────────────────────────────────────

@router.get("/choras/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(
    simulation_id: str,
    file_type: str,
    ir_filename: Optional[str] = None,
):
    """
    Retrieve a Choras simulation result file.

    Args:
        simulation_id: The simulation UUID.
        file_type: ``'wav'`` or ``'json'``.
        ir_filename: Specific WAV filename (for wav type only).  Must start with
            ``choras_{simulation_id}`` to prevent path traversal.
    """
    if file_type not in ("wav", "json"):
        raise HTTPException(status_code=400, detail="file_type must be 'wav' or 'json'")

    if file_type == "json":
        filename = f"choras_{simulation_id}_results.json"
        file_path = TEMP_DIR / filename
        media_type = "application/json"
    else:
        if ir_filename:
            # Security: ensure the filename belongs to this simulation
            expected_prefix = f"choras_{simulation_id}_"
            if not ir_filename.startswith(expected_prefix) and not ir_filename.startswith("choras_"):
                raise HTTPException(status_code=400, detail="Invalid IR filename for this simulation")
            file_path = RIR_OUTPUT_DIR / ir_filename
            filename = ir_filename
        else:
            wav_files = list(RIR_OUTPUT_DIR.glob(f"choras_{simulation_id}_*.wav"))
            if not wav_files:
                raise HTTPException(status_code=404, detail=f"No WAV files for simulation {simulation_id}")
            file_path = wav_files[0]
            filename = file_path.name
        media_type = "audio/wav"

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)


# ─── Main simulation endpoint (non-blocking) ─────────────────────────────────

@router.post("/choras/run-simulation-speckle", response_model=JobEnqueueResponse)
async def run_choras_simulation_speckle(
    req: Request,
    simulation_name: str = Form(...),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),            # JSON: {"objectId": "materialId"}
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),  # JSON: ["id1", ...]
    simulation_method: str = Form("DE"),          # "DE" or "DG"
    # ── DE settings ──────────────────────────────────────────────────────────
    de_c0: float = Form(CHORAS_DE_DEFAULT_C0),
    de_lc: float = Form(CHORAS_DE_DEFAULT_LC),
    # ── DG settings ──────────────────────────────────────────────────────────
    dg_freq_upper_limit: float = Form(CHORAS_DG_DEFAULT_FREQ_UPPER),
    dg_c0: float = Form(CHORAS_DG_DEFAULT_C0),
    dg_rho0: float = Form(CHORAS_DG_DEFAULT_RHO0),
    dg_poly_order: int = Form(CHORAS_DG_DEFAULT_POLY_ORDER),
    dg_ppw: float = Form(CHORAS_DG_DEFAULT_PPW),
    dg_cfl: float = Form(CHORAS_DG_DEFAULT_CFL),
    # ── Source-receiver pairs ─────────────────────────────────────────────────
    source_receiver_pairs: str = Form(...),        # JSON string
):
    """
    Start a Choras (DE or DG) acoustic simulation from a Speckle model.

    Returns immediately with {job_id, position, total}. Poll
    GET /api/jobs/{job_id} for progress updates — Speckle fetch, .geo
    generation, and the solve all happen in a worker child process
    (services/choras_job.py).
    """
    simulation_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    method = simulation_method.upper()

    if method not in ("DE", "DG"):
        raise HTTPException(status_code=400, detail="simulation_method must be 'DE' or 'DG'")

    try:
        pairs_data: list[dict] = json.loads(source_receiver_pairs)
        object_materials_dict: dict[str, str] = json.loads(object_materials)
        object_ids_filter: Optional[list[str]] = (
            json.loads(geometry_object_ids) if geometry_object_ids else None
        )

        if not pairs_data:
            raise HTTPException(status_code=400, detail="source_receiver_pairs is empty")

        frequencies = CHORAS_DEFAULT_FREQUENCIES
        de_settings = {
            "sim_len_type": "edt",
            "de_c0": de_c0,
            "de_lc": de_lc,
            "frequencies": frequencies,
        }
        dg_settings = {
            "dg_freq_upper_limit": dg_freq_upper_limit,
            "dg_c0": dg_c0,
            "dg_rho0": dg_rho0,
            "dg_poly_order": dg_poly_order,
            "dg_ppw": dg_ppw,
            "dg_cfl": dg_cfl,
            "frequencies": frequencies,
        }

        payload = {
            "kwargs": dict(
                simulation_id=simulation_id,
                speckle_project_id=speckle_project_id,
                speckle_version_id=speckle_version_id,
                layer_name=layer_name,
                object_ids_filter=object_ids_filter,
                object_materials_dict=object_materials_dict,
                simulation_method=method,
                de_settings=de_settings,
                dg_settings=dg_settings,
                frequencies=frequencies,
                source_receiver_pairs=pairs_data,
                simulation_name=simulation_name,
                temp_dir=str(TEMP_DIR),
            ),
        }

        job_id = await job_store.enqueue(JOB_TYPE_CHORAS, session_id, payload)
        view = await job_store.get(job_id)
        print(f"Choras simulation {job_id} queued at position {view.position} of {view.total}")
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Choras simulation setup error: {exc}")
        raise HTTPException(status_code=500, detail=f"Choras simulation failed: {exc}")

