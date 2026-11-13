"""
Hybrid wave-based + geometric simulation endpoints.

POST /hybrid/run-simulation-speckle
  Same geometry inputs as the other run endpoints, the settings of the geometric part
  (compas_acoustics: order, rays, diffraction, ...), of the wave part (PFFDTD: points per
  wavelength, duration) and the crossover (Schroeder frequency x factor, or a frequency).
  Enqueues one job on the PFFDTD queue (payload variant "hybrid", services/hybrid_job.py).
  Returns {job_id, position, total}; poll GET /api/jobs/{job_id}. Results are read through
  the PFFDTD file endpoint (GET /api/pffdtd/get-result-file/...).

GET /hybrid/status
  Whether both engines are installed.

GET /hybrid/crossover-estimate
  The crossover a room of a given volume and decay time would get, for the card's read-out.
"""
from __future__ import annotations

import importlib.util
import traceback
import uuid
from typing import Optional

from config.constants import (
    CA_AIR_HUMIDITY_DEFAULT,
    CA_DIFFRACTION_DEFAULT,
    CA_SEED_DEFAULT,
    CA_TAIL_DEFAULT,
    DEFAULT_SPEED_OF_SOUND,
    HYBRID_CROSSOVER_FACTOR_DEFAULT,
    HYBRID_CROSSOVER_FACTOR_MAX,
    HYBRID_CROSSOVER_FACTOR_MIN,
    HYBRID_CROSSOVER_MAX_HZ,
    HYBRID_CROSSOVER_MIN_HZ,
    HYBRID_CROSSOVER_MODES,
    HYBRID_WAVE_FMAX_MARGIN,
    JOB_TYPE_PFFDTD,
    PFFDTD_DEFAULT_PPW,
    PFFDTD_DURATION_MAX,
    PFFDTD_DURATION_MIN,
    PFFDTD_PPW_MAX,
    PFFDTD_PPW_MIN,
    PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
    PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    PYROOMACOUSTICS_DEFAULT_PARALLEL,
    PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
    PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    PYROOMACOUSTICS_MAX_ORDER_MAX,
    PYROOMACOUSTICS_MAX_ORDER_MIN,
    PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
)
from fastapi import APIRouter, Form, HTTPException, Request
from models.schemas import JobEnqueueResponse
from routers.acoustic_paths import parse_excluded_edges
from routers.pffdtd import RIR_OUTPUT_DIR, TEMP_DIR, _check_directional_runs, _check_range, _parse_geometry_fields
from routers.pyroomacoustics import normalize_tail, validate_engine_settings, validate_tail_settings
from services.job_store import job_store
from services.pffdtd_job import pffdtd_available
from services.pyroomacoustics_service import PyroomacousticsService
from utils.hybrid_crossover import CROSSOVER_MANUAL, plan_crossover
from utils.request_parsing import parse_mesh_settings
import json

router = APIRouter(prefix="/api")


def hybrid_unavailable() -> Optional[str]:
    """Why the hybrid simulation cannot run here, or None."""
    reason = pffdtd_available()
    if reason:
        return f"wave solver: {reason}"
    if importlib.util.find_spec("compas_acoustics") is None:
        return "compas_acoustics (the geometric engine) is not installed"
    return None


@router.get("/hybrid/status")
async def get_status():
    reason = hybrid_unavailable()
    return {
        "available": reason is None,
        "reason": reason,
        "wave_fmax_margin": HYBRID_WAVE_FMAX_MARGIN,
        "crossover_min_hz": HYBRID_CROSSOVER_MIN_HZ,
        "crossover_max_hz": HYBRID_CROSSOVER_MAX_HZ,
    }


@router.get("/hybrid/crossover-estimate")
async def crossover_estimate(
    volume: float,
    rt60: float,
    mode: str = "schroeder",
    crossover_hz: Optional[float] = None,
    factor: float = HYBRID_CROSSOVER_FACTOR_DEFAULT,
):
    try:
        return plan_crossover(mode, rt60, volume, manual_hz=crossover_hz, factor=factor).as_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/hybrid/run-simulation-speckle", response_model=JobEnqueueResponse)
async def run_simulation_speckle(
    req: Request,
    simulation_name: str = Form(...),
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
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),
    # crossover
    crossover_mode: str = Form("schroeder"),
    crossover_hz: Optional[float] = Form(None),
    crossover_factor: float = Form(HYBRID_CROSSOVER_FACTOR_DEFAULT),
    level_match: bool = Form(False),
    # wave part
    ppw: float = Form(PFFDTD_DEFAULT_PPW),
    duration: Optional[float] = Form(None),          # default: from the room's decay time
    # geometric part
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    n_rays: int = Form(PYROOMACOUSTICS_RAY_TRACING_N_RAYS),
    air_absorption: bool = Form(PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION),
    sound_speed: float = Form(DEFAULT_SPEED_OF_SOUND),
    parallel: bool = Form(PYROOMACOUSTICS_DEFAULT_PARALLEL),
    diffraction: str = Form(CA_DIFFRACTION_DEFAULT),
    tail: str = Form(CA_TAIL_DEFAULT),
    n_slopes: int = Form(1),
    seed: int = Form(CA_SEED_DEFAULT),
    scattering_split: bool = Form(False),
    air_temperature: Optional[float] = Form(None),
    air_humidity: float = Form(CA_AIR_HUMIDITY_DEFAULT),
    excluded_edges: Optional[str] = Form(None),
):
    """Validate and enqueue; both engines and the join run in the PFFDTD worker's child process."""
    reason = hybrid_unavailable()
    if reason:
        raise HTTPException(status_code=503, detail=f"The hybrid simulation is not available: {reason}")
    if simulation_mode not in (PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA):
        raise HTTPException(status_code=400, detail="The hybrid simulation outputs 'mono' or 'foa'")
    if crossover_mode not in HYBRID_CROSSOVER_MODES:
        raise HTTPException(status_code=400, detail=f"crossover_mode must be one of {list(HYBRID_CROSSOVER_MODES)}")
    if crossover_mode == CROSSOVER_MANUAL:
        if crossover_hz is None:
            raise HTTPException(status_code=400, detail="A manual crossover needs crossover_hz")
        _check_range("crossover_hz", crossover_hz, HYBRID_CROSSOVER_MIN_HZ, HYBRID_CROSSOVER_MAX_HZ)
    _check_range("crossover_factor", crossover_factor, HYBRID_CROSSOVER_FACTOR_MIN, HYBRID_CROSSOVER_FACTOR_MAX)
    _check_range("ppw", ppw, PFFDTD_PPW_MIN, PFFDTD_PPW_MAX)
    if duration is not None:
        _check_range("duration", duration, PFFDTD_DURATION_MIN, PFFDTD_DURATION_MAX)
    _check_range("max_order", max_order, PYROOMACOUSTICS_MAX_ORDER_MIN, PYROOMACOUSTICS_MAX_ORDER_MAX)
    validate_engine_settings("compas_acoustics", simulation_mode, diffraction, None, air_temperature, air_humidity)
    validate_tail_settings(tail, n_slopes)
    tail = normalize_tail(tail)
    excluded_edge_rows = parse_excluded_edges(excluded_edges)

    simulation_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    pairs_data, object_materials_dict, object_ids_filter = _parse_geometry_fields(
        req, source_receiver_pairs, object_materials, geometry_object_ids, custom_materials, model_id,
    )
    _check_directional_runs(pairs_data, simulation_mode, "off")
    try:
        scattering = json.loads(object_scattering) if object_scattering else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid object_scattering: {exc}")
    mesh_prep = parse_mesh_settings(mesh_settings)

    try:
        PyroomacousticsService.validate_unit_scale(
            source_positions=[p["source_position"] for p in pairs_data],
            receiver_positions=[p["receiver_position"] for p in pairs_data],
        )
        payload = {
            "variant": "hybrid",
            "kwargs": dict(
                simulation_id=simulation_id,
                speckle_project_id=speckle_project_id,
                speckle_version_id=speckle_version_id,
                layer_name=layer_name,
                object_ids_filter=object_ids_filter,
                object_materials_dict=object_materials_dict,
                object_scattering_dict=scattering,
                pairs_data=pairs_data,
                simulation_mode=simulation_mode,
                simulation_name=simulation_name,
                rir_output_dir=str(RIR_OUTPUT_DIR),
                temp_dir=str(TEMP_DIR),
                mesh_settings=mesh_prep.model_dump(),
                crossover_mode=crossover_mode,
                crossover_hz=crossover_hz,
                crossover_factor=crossover_factor,
                level_match=level_match,
                ppw=ppw,
                duration=duration,
                max_order=max_order,
                ray_tracing=ray_tracing,
                n_rays=n_rays,
                air_absorption=air_absorption,
                sound_speed=sound_speed,
                parallel=parallel,
                diffraction=diffraction,
                tail=tail,
                n_slopes=n_slopes,
                seed=seed,
                scattering_split=scattering_split,
                air_temperature=air_temperature,
                air_humidity=air_humidity,
                excluded_edges=excluded_edge_rows,
            ),
        }
        job_id = await job_store.enqueue(JOB_TYPE_PFFDTD, session_id, payload)
        view = await job_store.get(job_id)
        print(f"Hybrid simulation {job_id} queued at position {view.position} of {view.total}")
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Hybrid setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Hybrid simulation setup failed: {exc}")
