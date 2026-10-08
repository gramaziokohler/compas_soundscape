"""
Geometry preflight worker — runs in a CPU-worker child process.

Loads the same inputs as the simulation (Speckle geometry + materials +
source/receiver pairs + mesh settings), runs the shared
``SimulationMeshService.prepare``, analyses it and writes the preview payload
to ``<payload_dir>/preflight_<id>.json``. Progress/result use the standard
atomic JSON contract (see services/pyroomacoustics_worker.py).
"""

from __future__ import annotations

import json
import os
import traceback
from pathlib import Path

from models.schemas import MeshPrepSettings
from services.pyroomacoustics_worker import _write_progress, _write_result
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService
from services.simulation_preflight_service import (
    ENGINE_CHORAS,
    PreflightContext,
    SeedMeta,
    SimulationPreflightService,
    summarize,
    two_sided_supported,
)
from utils.geometry import seeds_from_pairs
from utils.preflight_payload import build_preflight_payload


def preflight_payload_path(payload_dir: str, preflight_id: str) -> Path:
    return Path(payload_dir) / f"preflight_{preflight_id}.json"


def run_simulation_preflight(
    preflight_id: str,
    progress_file: str,
    result_file: str,
    engine: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter,
    object_materials_dict: dict,
    object_scattering_dict: dict,
    pairs_data: list,
    max_order: int,
    ray_tracing: bool,
    mesh_settings: dict,
    payload_dir: str,
) -> None:
    try:
        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter,
            object_materials_dict, object_scattering_dict,
            progress=lambda v, s: _write_progress(progress_file, v, s),
        )

        settings = MeshPrepSettings(**(mesh_settings or {}))
        if engine == ENGINE_CHORAS:
            settings = settings.model_copy(update={"merge_coplanar": False})
        seed_meta = seeds_from_pairs(pairs_data)

        _write_progress(progress_file, 25, "Welding and orienting the simulation mesh...")
        mesh = SimulationMeshService.prepare(
            inputs.vertices, inputs.faces, inputs.object_face_ranges,
            inputs.face_materials, inputs.face_scattering,
            [s["position"] for s in seed_meta], MeshPrepOptions.from_settings(settings),
        )

        _write_progress(progress_file, 80, "Checking sources, receivers, leaks and obstructions...")
        ctx = PreflightContext(
            engine=engine,
            seeds=[SeedMeta(**s) for s in seed_meta],
            pairs=[(str(p["source_id"]), str(p["receiver_id"])) for p in pairs_data],
            max_order=int(max_order),
            ray_tracing=bool(ray_tracing),
            two_sided_supported=two_sided_supported(),
        )
        analysis = SimulationPreflightService.analyze(mesh, ctx)

        _write_progress(progress_file, 92, "Writing preview...")
        payload = build_preflight_payload(
            preflight_id, engine, mesh, analysis, ctx, settings.model_dump()
        )
        os.makedirs(payload_dir, exist_ok=True)
        path = preflight_payload_path(payload_dir, preflight_id)
        tmp = str(path) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, path)

        counts = summarize(analysis.issues)
        print(
            f"[preflight {preflight_id[:8]}] {engine}: {len(mesh.faces)} faces, "
            f"{len(mesh.walls)} walls, {counts}"
        )
        _write_result(result_file, {
            "type": "done",
            "result": {
                "preflight_id": preflight_id,
                "engine": engine,
                **counts,
                "payload_file": path.name,
            },
        })
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"Preflight error [{preflight_id}]:\n{tb}")
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
