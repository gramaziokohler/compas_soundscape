"""
Pyroomacoustics acoustic simulation endpoints.

POST /pyroomacoustics/run-simulation-speckle
  Validates basic params, enqueues a "pyroomacoustics" job on the Redis job
  store, returns {job_id, position, total} immediately. Speckle fetch + room
  build + compute_rir run in a worker child process (workers/cpu_runner.py).

POST /pyroomacoustics/run-simulation-geometry
  Direct-geometry variant (Grasshopper → JSON).  Geometry is supplied inline
  as a JSON body instead of being fetched from Speckle.  Same job store,
  same polling endpoint (GET /api/jobs/{job_id}).
"""
from __future__ import annotations

import json
import traceback
import uuid
from pathlib import Path
from typing import List
from typing import Optional

from config.constants import ACOUSTICS_ENGINE_COMPAS_ACOUSTICS
from config.constants import ACOUSTICS_ENGINE_DEFAULT
from config.constants import ACOUSTICS_ENGINES
from config.constants import CA_AIR_HUMIDITY_DEFAULT
from config.constants import CA_AMBISONIC_ORDER_MAX
from config.constants import CA_DIFFRACTION_DEFAULT
from config.constants import CA_DIFFRACTION_MODELS
from config.constants import CA_DIFFRACTION_OFF
from config.constants import CA_N_SLOPES_MAX
from config.constants import CA_SEED_DEFAULT
from config.constants import CA_TAIL_DEFAULT
from config.constants import CA_TAILS
from config.constants import DEFAULT_SPEED_OF_SOUND
from config.constants import PYROOMACOUSTICS_DEFAULT_ABSORPTION
from config.constants import PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION
from config.constants import PYROOMACOUSTICS_DEFAULT_MAX_ORDER
from config.constants import PYROOMACOUSTICS_DEFAULT_PARALLEL
from config.constants import PYROOMACOUSTICS_DEFAULT_RAY_TRACING
from config.constants import PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE
from config.constants import PYROOMACOUSTICS_MAX_ORDER_MAX
from config.constants import PYROOMACOUSTICS_MAX_ORDER_MIN
from config.constants import PYROOMACOUSTICS_RAY_TRACING_N_RAYS
from config.constants import PYROOMACOUSTICS_RIR_DIR
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_FOA
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_HOA
from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_MONO
from config.constants import TEMP_SIMULATIONS_DIR
from config.constants import JOB_TYPE_PYROOMACOUSTICS
from fastapi import APIRouter
from fastapi import Form
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import FileResponse
from models.schemas import PyroomacousticsGeometryRequest
from models.schemas import JobEnqueueResponse
from models.schemas import MeshPrepSettings
from models.schemas import SourceReceiverPair
from pydantic import BaseModel
from services.custom_materials_service import inline_custom_materials
from services.directivity_service import attach_directivity_specs
from services.job_store import job_store
from services.pyroomacoustics_service import PyroomacousticsService
from utils.request_parsing import parse_mesh_settings, parse_source_receiver_pairs

router = APIRouter(prefix="/api")

RIR_OUTPUT_DIR = Path(PYROOMACOUSTICS_RIR_DIR)
RIR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)


def validate_tail_settings(tail: str, n_slopes: int) -> None:
    if tail not in CA_TAILS:
        raise HTTPException(status_code=400, detail=f"tail must be one of {list(CA_TAILS)}")
    if not 1 <= n_slopes <= CA_N_SLOPES_MAX:
        raise HTTPException(status_code=400, detail=f"n_slopes must be 1 to {CA_N_SLOPES_MAX}")


def validate_engine_settings(
    engine: str,
    simulation_mode: str,
    diffraction: str,
    ambisonic_order: Optional[int],
    air_temperature: Optional[float],
    air_humidity: float,
) -> None:
    """400 for an engine / output / diffraction combination the engine cannot run."""
    if engine not in ACOUSTICS_ENGINES:
        raise HTTPException(status_code=400, detail=f"Unknown engine '{engine}'; one of {list(ACOUSTICS_ENGINES)}")
    modes = (PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA, PYROOMACOUSTICS_SIMULATION_MODE_HOA)
    if simulation_mode not in modes:
        raise HTTPException(status_code=400, detail=f"Invalid simulation mode: {simulation_mode}")
    if diffraction not in CA_DIFFRACTION_MODELS:
        raise HTTPException(status_code=400, detail=f"diffraction must be one of {list(CA_DIFFRACTION_MODELS)}")
    if engine != ACOUSTICS_ENGINE_COMPAS_ACOUSTICS:
        if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_HOA:
            raise HTTPException(status_code=400, detail="Higher-order ambisonics needs the compas_acoustics engine")
        if diffraction != CA_DIFFRACTION_OFF:
            raise HTTPException(status_code=400, detail="Edge diffraction needs the compas_acoustics engine")
        return
    if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO and diffraction == "btms":
        raise HTTPException(status_code=400, detail="BTMS diffraction needs an ambisonic output; use 'udfa' for mono")
    if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_HOA and ambisonic_order is not None and not 2 <= ambisonic_order <= CA_AMBISONIC_ORDER_MAX:
        raise HTTPException(status_code=400, detail=f"ambisonic_order must be 2 to {CA_AMBISONIC_ORDER_MAX} for 'hoa'")
    if air_temperature is not None and not 0.0 <= air_temperature <= 30.0:
        raise HTTPException(status_code=400, detail="air_temperature must be within 0 to 30 deg C")
    if not 0.0 <= air_humidity <= 100.0:
        raise HTTPException(status_code=400, detail="air_humidity must be within 0 to 100 %")


# ─── Pydantic models (local use only) ─────────────────────────────────────────

class SimulationSettings(BaseModel):
    max_order: int = PYROOMACOUSTICS_DEFAULT_MAX_ORDER
    ray_tracing: bool = PYROOMACOUSTICS_DEFAULT_RAY_TRACING
    air_absorption: bool = PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION


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
    response_model=JobEnqueueResponse,
)
async def run_simulation_speckle(
    req: Request,
    simulation_name: str = Form(...),
    speckle_project_id: str = Form(...),
    speckle_version_id: str = Form(...),
    object_materials: str = Form(...),
    custom_materials: str = Form("{}"),
    layer_name: str = Form("Acoustics"),
    geometry_object_ids: Optional[str] = Form(None),
    max_order: int = Form(PYROOMACOUSTICS_DEFAULT_MAX_ORDER),
    ray_tracing: bool = Form(PYROOMACOUSTICS_DEFAULT_RAY_TRACING),
    air_absorption: bool = Form(PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION),
    n_rays: int = Form(PYROOMACOUSTICS_RAY_TRACING_N_RAYS),
    parallel: bool = Form(PYROOMACOUSTICS_DEFAULT_PARALLEL),
    object_scattering: str = Form("{}"),
    simulation_mode: str = Form(PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE),
    sound_speed: float = Form(DEFAULT_SPEED_OF_SOUND),
    source_receiver_pairs: str = Form(...),
    mesh_settings: Optional[str] = Form(None),
    model_id: Optional[str] = Form(None),  # resolves shared-soundscape directivity copies
    engine: str = Form(ACOUSTICS_ENGINE_DEFAULT),
    diffraction: str = Form(CA_DIFFRACTION_DEFAULT),
    ambisonic_order: Optional[int] = Form(None),  # 'hoa' mode: 2 or 3
    air_temperature: Optional[float] = Form(None),  # deg C; default: from sound_speed
    air_humidity: float = Form(CA_AIR_HUMIDITY_DEFAULT),
    tail: str = Form(CA_TAIL_DEFAULT),              # ambisonic late field (CA_TAILS)
    n_slopes: int = Form(1),
    seed: int = Form(CA_SEED_DEFAULT),
    scattering_split: bool = Form(False),
    excluded_edges: Optional[str] = Form(None),      # JSON [[x1,y1,z1,x2,y2,z2], ...]
):
    """
    Validate basic params and enqueue the simulation.  Returns {job_id,
    position, total} immediately — Speckle fetch and compute happen in a
    worker child process. Poll GET /api/jobs/{job_id} for updates.
    """
    simulation_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    user_hash = getattr(getattr(req, "state", None), "user_hash", None)

    try:
        pairs = parse_source_receiver_pairs(source_receiver_pairs)
        pairs_data = attach_directivity_specs(pairs, user_hash, session_id, model_id)
        object_materials_dict = inline_custom_materials(json.loads(object_materials), custom_materials)
        object_ids_filter = json.loads(geometry_object_ids) if geometry_object_ids else None
        object_scattering_dict: dict[str, float] = json.loads(object_scattering) if object_scattering else {}
        mesh_prep = parse_mesh_settings(mesh_settings)

        validate_engine_settings(engine, simulation_mode, diffraction, ambisonic_order, air_temperature, air_humidity)
        validate_tail_settings(tail, n_slopes)
        from routers.acoustic_paths import parse_excluded_edges
        excluded_edge_rows = parse_excluded_edges(excluded_edges)

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
        print("Pyroomacoustics Speckle Simulation Request")
        print(f"Simulation ID: {simulation_id}")
        print(f"Project: {speckle_project_id}  Version: {speckle_version_id}")
        print(f"Layer: {layer_name}  Mode: {simulation_mode}  Pairs: {len(pairs_data)}  Engine: {engine}  Diffraction: {diffraction}")
        print(f"{'='*60}\n")

        payload = {
            "variant": "pyroomacoustics_speckle",
            "kwargs": dict(
                simulation_id=simulation_id,
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
                parallel=parallel,
                sound_speed=sound_speed,
                pairs_data=pairs_data,
                simulation_name=simulation_name,
                rir_output_dir=str(RIR_OUTPUT_DIR),
                temp_dir=str(TEMP_DIR),
                mesh_settings=mesh_prep.model_dump(),
                engine=engine,
                diffraction=diffraction,
                ambisonic_order=ambisonic_order,
                air_temperature=air_temperature,
                air_humidity=air_humidity,
                tail=tail,
                n_slopes=n_slopes,
                seed=seed,
                scattering_split=scattering_split,
                excluded_edges=excluded_edge_rows,
            ),
        }

        job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, session_id, payload)
        view = await job_store.get(job_id)
        print(f"Simulation {job_id} queued at position {view.position} of {view.total}")
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Pyroomacoustics setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Simulation setup failed: {str(exc)}")


# ─── Run simulation — direct geometry (Grasshopper) ───────────────────────────

_UNIT_TO_METERS = {
    "m": 1.0,
    "mm": 0.001,
    "cm": 0.01,
    "ft": 0.3048,
}


@router.post(
    "/pyroomacoustics/run-simulation-geometry",
    response_model=JobEnqueueResponse,
)
async def run_simulation_geometry(body: PyroomacousticsGeometryRequest, http_req: Request):
    """
    Direct-geometry simulation: the room mesh, materials, sources and receivers
    are supplied inline as a JSON body (e.g. from a Grasshopper component).

    Faces whose group has no material entry are skipped by the worker.  Units
    are converted to meters here so the worker child process always works in
    meters. Returns {job_id, position, total} immediately — poll
    GET /api/jobs/{job_id}.
    """
    simulation_id = str(uuid.uuid4())
    session_id = getattr(getattr(http_req, "state", None), "session_id", None)
    req = body

    try:
        settings = req.settings
        validate_engine_settings(
            settings.engine, settings.simulation_mode, settings.diffraction, settings.ambisonic_order,
            settings.air_temperature, settings.air_humidity,
        )
        validate_tail_settings(settings.tail, settings.n_slopes)

        if settings.max_order < PYROOMACOUSTICS_MAX_ORDER_MIN or settings.max_order > PYROOMACOUSTICS_MAX_ORDER_MAX:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"max_order must be between {PYROOMACOUSTICS_MAX_ORDER_MIN} "
                    f"and {PYROOMACOUSTICS_MAX_ORDER_MAX}"
                ),
            )

        # ── Face / vertex index validation ────────────────────────────────────
        n_verts = len(req.vertices)
        n_faces = len(req.faces)
        if not req.face_groups:
            raise HTTPException(
                status_code=400,
                detail="face_groups must contain at least one group — every simulated face needs a material",
            )
        for face in req.faces:
            if any(idx < 0 or idx >= n_verts for idx in face):
                raise HTTPException(
                    status_code=400,
                    detail="Face contains a vertex index outside the vertex array",
                )
        for group_id, face_indices in req.face_groups.items():
            if any(fi < 0 or fi >= n_faces for fi in face_indices):
                raise HTTPException(
                    status_code=400,
                    detail=f"Face group '{group_id}' references a face index outside the face array",
                )

        # ── Unit conversion (all coordinates → meters) ────────────────────────
        scale = _UNIT_TO_METERS[req.units]
        vertices_m = [[x * scale, y * scale, z * scale] for (x, y, z) in req.vertices]
        sources_m = [
            {"id": s.id, "position": [c * scale for c in s.position]}
            for s in req.sources
        ]
        receivers_m = [
            {"id": r.id, "position": [c * scale for c in r.position]}
            for r in req.receivers
        ]

        PyroomacousticsService.validate_unit_scale(
            source_positions=[s["position"] for s in sources_m],
            receiver_positions=[r["position"] for r in receivers_m],
        )

        print(f"\n{'='*60}")
        print("Pyroomacoustics Geometry Simulation Request")
        print(f"Simulation ID: {simulation_id}")
        print(f"Units: {req.units} (scaled to meters)  Mode: {settings.simulation_mode}")
        print(f"Vertices: {len(vertices_m)}  Faces: {n_faces}  "
              f"Groups: {len(req.face_groups)}  Sources: {len(sources_m)}  "
              f"Receivers: {len(receivers_m)}")
        print(f"{'='*60}\n")

        # ── Persist normalized geometry for the subprocess handoff ────────────
        materials_payload: dict = {}
        for group_id, mat in req.materials.items():
            if mat.name:
                resolved = PyroomacousticsService.get_material_by_id(mat.name)
                if resolved is None:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Unknown pyroomacoustics material id '{mat.name}' for "
                            f"group '{group_id}'. Available ids are returned by "
                            "GET /api/pyroomacoustics/materials."
                        ),
                    )
                materials_payload[group_id] = resolved
            else:
                materials_payload[group_id] = {
                    "absorption": mat.absorption,
                    "scattering": mat.scattering,
                }

        geometry_payload = {
            "vertices": vertices_m,
            "faces": req.faces,
            "face_groups": req.face_groups,
            "materials": materials_payload,
            "sources": sources_m,
            "receivers": receivers_m,
        }
        geometry_file = str(TEMP_DIR / f"geometry_{simulation_id}.json")
        with open(geometry_file, "w") as f:
            json.dump(geometry_payload, f)

        payload = {
            "variant": "pyroomacoustics_geometry",
            "kwargs": dict(
                simulation_id=simulation_id,
                geometry_file=geometry_file,
                simulation_mode=settings.simulation_mode,
                max_order=settings.max_order,
                ray_tracing=settings.ray_tracing,
                air_absorption=settings.air_absorption,
                n_rays=settings.n_rays,
                parallel=settings.parallel,
                sound_speed=settings.sound_speed,
                simulation_name=req.simulation_name,
                rir_output_dir=str(RIR_OUTPUT_DIR),
                temp_dir=str(TEMP_DIR),
                mesh_settings=(req.mesh_settings or MeshPrepSettings()).model_dump(),
                engine=settings.engine,
                diffraction=settings.diffraction,
                ambisonic_order=settings.ambisonic_order,
                air_temperature=settings.air_temperature,
                air_humidity=settings.air_humidity,
                tail=settings.tail,
                n_slopes=settings.n_slopes,
                seed=settings.seed,
                scattering_split=settings.scattering_split,
                excluded_edges=settings.excluded_edges,
            ),
        }

        job_id = await job_store.enqueue(JOB_TYPE_PYROOMACOUSTICS, session_id, payload)
        view = await job_store.get(job_id)
        print(f"Simulation {job_id} queued at position {view.position} of {view.total}")
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Pyroomacoustics geometry setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Simulation setup failed: {str(exc)}")


def init_pyroomacoustics_router():
    return router

