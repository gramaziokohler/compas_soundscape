"""
Pyroomacoustics acoustic simulation endpoints.

POST /pyroomacoustics/run-simulation-speckle
  Validates basic params, queues the job, returns simulation_id immediately.
  Speckle fetch + room build + compute_rir run in a subprocess.

GET  /pyroomacoustics/simulation-status/{id}
  Poll for progress, queue position, or completed result.

POST /pyroomacoustics/cancel-simulation/{id}
  Kill the subprocess immediately (hard kill).
"""
from __future__ import annotations

import json
import traceback
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.pyroomacoustics_service import PyroomacousticsService
from services.pyroomacoustics_worker import run_pyroomacoustics_simulation
from services.task_queue import unified_queue, make_subprocess_runner
from models.schemas import (
    PyroomacousticsSimulationStartResponse,
    PyroomacousticsSimulationResult,
    PyroomacousticsSimulationStatusResponse,
)
from config.constants import (
    PYROOMACOUSTICS_RIR_DIR,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
    PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
    PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
    PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    TEMP_SIMULATIONS_DIR,
    PYROOMACOUSTICS_DEFAULT_ABSORPTION,
    PYROOMACOUSTICS_TASK_CLEANUP_DELAY_SECONDS,
)

router = APIRouter()

RIR_OUTPUT_DIR = Path(PYROOMACOUSTICS_RIR_DIR)
RIR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)


# ─── Pydantic models (local use only) ─────────────────────────────────────────

class SimulationSettings(BaseModel):
    max_order: int = PYROOMACOUSTICS_DEFAULT_MAX_ORDER
    ray_tracing: bool = PYROOMACOUSTICS_DEFAULT_RAY_TRACING
    air_absorption: bool = PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION


class SourceReceiverPair(BaseModel):
    source_position: List[float]
    receiver_position: List[float]
    source_id: str
    receiver_id: str


class RunSimulationRequest(BaseModel):
    simulation_name: str
    settings: SimulationSettings
    source_receiver_pairs: List[SourceReceiverPair]
    selected_material_id: Optional[str] = None


class SimulationResult(BaseModel):
    simulation_id: str
    message: str
    ir_files: List[str]
    results_file: str


# ─── Materials endpoint ────────────────────────────────────────────────────────

@router.get("/pyroomacoustics/materials")
async def get_materials():
    try:
        materials_db = PyroomacousticsService.get_material_database()
        materials = [
            {
                "id": material_id,
                "name": material_id.replace("_", " ").title(),
                "description": props.get("description", ""),
                "coeffs": props.get("coeffs", []),
                "center_freqs": props.get("center_freqs", [125, 250, 500, 1000, 2000, 4000, 8000]),
                "absorption": (
                    sum(props["coeffs"]) / len(props["coeffs"])
                    if props.get("coeffs") else PYROOMACOUSTICS_DEFAULT_ABSORPTION
                ),
            }
            for category_materials in materials_db.values()
            for material_id, props in category_materials.items()
        ]
        return materials
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load materials: {str(e)}")


# ─── File download endpoint ────────────────────────────────────────────────────

@router.get("/pyroomacoustics/get-result-file/{simulation_id}/{file_type}")
async def get_result_file(simulation_id: str, file_type: str, ir_filename: Optional[str] = None):
    if file_type not in ("wav", "json", "jpg"):
        raise HTTPException(status_code=400, detail="file_type must be 'wav', 'json', or 'jpg'")

    if file_type == "json":
        filename = f"simulation_{simulation_id}_results.json"
        file_path = TEMP_DIR / filename
        media_type = "application/json"
    else:
        if ir_filename:
            if not ir_filename.startswith(f"sim_{simulation_id}_"):
                raise HTTPException(status_code=400, detail="Invalid IR filename for this simulation")
            file_path = RIR_OUTPUT_DIR / ir_filename
            filename = ir_filename
        else:
            ir_files = list(RIR_OUTPUT_DIR.glob(f"sim_{simulation_id}_*.wav"))
            if not ir_files:
                raise HTTPException(status_code=404, detail=f"No WAV files found for simulation {simulation_id}")
            file_path = ir_files[0]
            filename = file_path.name
        media_type = "audio/wav"

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    return FileResponse(path=str(file_path), media_type=media_type, filename=filename)


# ─── Run simulation ────────────────────────────────────────────────────────────

@router.post(
    "/pyroomacoustics/run-simulation-speckle",
    response_model=PyroomacousticsSimulationStartResponse,
)
async def run_simulation_speckle(
    simulation_name: str = Form(...),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    air_absorption: bool = Form(PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION),
    n_rays: int = Form(PYROOMACOUSTICS_RAY_TRACING_N_RAYS),
    object_scattering: str = Form("{}"),
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),
    source_receiver_pairs: str = Form(...),
):
    """
    Validate basic params and enqueue the simulation.  Returns simulation_id
    immediately — Speckle fetch and compute happen in a subprocess.

    Poll GET /pyroomacoustics/simulation-status/{simulation_id} for updates.
    """
    simulation_id = str(uuid.uuid4())

    try:
        pairs_data = json.loads(source_receiver_pairs)
        object_materials_dict = json.loads(object_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        object_scattering_dict: dict[str, float] = json.loads(object_scattering) if object_scattering else {}

        if simulation_mode not in (PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA):
            raise HTTPException(status_code=400, detail=f"Invalid simulation mode: {simulation_mode}")

        if not pairs_data:
            raise HTTPException(status_code=400, detail="No source-receiver pairs provided")

        unique_sources: dict[str, list] = {}
        unique_receivers: dict[str, list] = {}
        for pair_dict in pairs_data:
            s_id, r_id = pair_dict["source_id"], pair_dict["receiver_id"]
            if s_id not in unique_sources:
                unique_sources[s_id] = pair_dict["source_position"]
            if r_id not in unique_receivers:
                unique_receivers[r_id] = pair_dict["receiver_position"]

        PyroomacousticsService.validate_unit_scale(
            source_positions=list(unique_sources.values()),
            receiver_positions=list(unique_receivers.values()),
        )

        print(f"\n{'='*60}")
        print(f"Pyroomacoustics Speckle Simulation Request")
        print(f"Simulation ID: {simulation_id}")
        print(f"Project: {speckle_project_id}  Version: {speckle_version_id}")
        print(f"Layer: {layer_name}  Mode: {simulation_mode}  Pairs: {len(pairs_data)}")
        print(f"{'='*60}\n")

        progress_file = str(TEMP_DIR / f"progress_{simulation_id}.json")
        result_file   = str(TEMP_DIR / f"result_{simulation_id}.json")

        worker_kwargs = dict(
            simulation_id=simulation_id,
            progress_file=progress_file,
            result_file=result_file,
            speckle_project_id=speckle_project_id,
            speckle_version_id=speckle_version_id,
            layer_name=layer_name,
            object_ids_filter=object_ids_filter,
            object_materials_dict=object_materials_dict,
            object_scattering_dict=object_scattering_dict,
            simulation_mode=simulation_mode,
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption,
            n_rays=n_rays,
            pairs_data=pairs_data,
            simulation_name=simulation_name,
            rir_output_dir=str(RIR_OUTPUT_DIR),
            temp_dir=str(TEMP_DIR),
        )

        run_fn = make_subprocess_runner(
            run_pyroomacoustics_simulation,
            worker_kwargs,
            progress_file,
            result_file,
            error_prefix="Simulation",
        )

        pos, total = unified_queue.enqueue(
            simulation_id, "pyroomacoustics", run_fn, PYROOMACOUSTICS_TASK_CLEANUP_DELAY_SECONDS
        )
        print(f"Simulation {simulation_id} queued at position {pos} of {total}")
        return PyroomacousticsSimulationStartResponse(simulation_id=simulation_id)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Pyroomacoustics setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Simulation setup failed: {str(exc)}")


# ─── Status endpoint ───────────────────────────────────────────────────────────

@router.get(
    "/pyroomacoustics/simulation-status/{simulation_id}",
    response_model=PyroomacousticsSimulationStatusResponse,
)
async def get_simulation_status(simulation_id: str):
    task = unified_queue.get_task(simulation_id)
    if not task:
        raise HTTPException(status_code=404, detail="Simulation not found")

    q_pos, q_total = unified_queue.get_queue_status(simulation_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    result_obj = None
    if task.completed and task.result and not task.error and not task.cancelled:
        result_obj = PyroomacousticsSimulationResult(**task.result)

    return PyroomacousticsSimulationStatusResponse(
        simulation_id=simulation_id,
        progress=task.progress,
        status=status_str,
        completed=task.completed,
        cancelled=task.cancelled,
        error=task.error,
        result=result_obj,
        queue_position=q_pos,
        queue_total=q_total,
    )


# ─── Cancel endpoint ───────────────────────────────────────────────────────────

@router.post("/pyroomacoustics/cancel-simulation/{simulation_id}")
async def cancel_simulation(simulation_id: str):
    if not unified_queue.get_task(simulation_id):
        raise HTTPException(status_code=404, detail="Simulation not found")
    unified_queue.cancel(simulation_id)
    return {"cancelled": True}


def init_pyroomacoustics_router():
    return router
