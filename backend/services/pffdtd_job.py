"""
PFFDTD (GPU FDTD) subprocess worker.

Runs as a multiprocessing child of workers/pffdtd_runner.py (compas-toy env):
Speckle fetch -> SimulationMeshService.prepare (same as the preflight) -> PFFDTD
scene export -> backend/pffdtd_backend/pipeline.py in the isolated compas-pffdtd
env (PFFDTD_PYTHON) -> float32 WAVs + metrics + results JSON.

Progress file: {"value": 0-100, "status": "<human text>"}
Result file:   {"type": "done",  "result": {...}}
            or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import traceback
from collections import OrderedDict
from pathlib import Path
from typing import Optional

import numpy as np
from scipy.io import wavfile

from config.constants import (
    AUDIO_SAMPLE_RATE,
    PFFDTD_ENGINE_EXE,
    PFFDTD_FOA_OFFSET_CELLS,
    PFFDTD_LOWCUT_HZ,
    PFFDTD_LOWCUT_ORDER,
    PFFDTD_LOWPASS_ORDER,
    PFFDTD_MATERIAL_CACHE_DIR,
    PFFDTD_PIPELINE_SCRIPT,
    PFFDTD_PRECISION,
    PFFDTD_PYTHON,
    PFFDTD_RELATIVE_HUMIDITY,
    PFFDTD_TEMP_DIR,
    PFFDTD_TEMPERATURE_C,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
)
from models.schemas import MeshPrepSettings
from services.pffdtd_scene_export import bounding_box, build_scene
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService
from services.simulation_preflight_service import (
    ENGINE_PFFDTD,
    PreflightContext,
    SeedMeta,
    SimulationPreflightService,
    summarize,
)
from utils.acoustic_measurement import AcousticMeasurement
from utils.geometry import seeds_from_pairs
from utils.pffdtd_grid import oblique_area_fraction, plan_grid

# progress bands of the whole job (pipeline progress is mapped into the middle band)
PROGRESS_GEOMETRY_END = 15
PROGRESS_PIPELINE_START = 20
PROGRESS_PIPELINE_END = 92
CHANNELS_FOA = ["W", "Y", "Z", "X"]


def _atomic_write(path: str, payload: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    for attempt in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.02 * (attempt + 1))


def _write_progress(progress_file: str, value: float, status: str) -> None:
    _atomic_write(progress_file, {"value": int(value), "status": status})


def pffdtd_available() -> Optional[str]:
    """None if the solver can run here, else a human-readable reason."""
    if not PFFDTD_PYTHON or not Path(PFFDTD_PYTHON).exists():
        return "PFFDTD_PYTHON is not set to the compas-pffdtd python.exe (see deploy/README.md)"
    if not Path(PFFDTD_ENGINE_EXE).exists():
        return f"PFFDTD engine not built ({PFFDTD_ENGINE_EXE}); run backend/pffdtd_backend/c_cuda/build_engine.ps1"
    return None


def _pipeline_env() -> dict:
    """compas-pffdtd's DLL folders first (numpy/BLAS and hdf5 need them on Windows)."""
    prefix = Path(PFFDTD_PYTHON).parent
    env = dict(os.environ)
    extra = [prefix, prefix / "Library" / "bin", prefix / "Scripts"]
    env["PATH"] = os.pathsep.join([str(p) for p in extra] + [env.get("PATH", "")])
    env["PYTHONUTF8"] = "1"
    env.pop("PYTHONPATH", None)
    return env


def _run_pipeline(job_path: Path, progress_file: str) -> None:
    log_path = job_path.with_name("pipeline.log")
    error = None
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(
            [PFFDTD_PYTHON, "-I", PFFDTD_PIPELINE_SCRIPT, str(job_path), "--parent-pid", str(os.getpid())],
            stdout=subprocess.PIPE,
            stderr=log,
            env=_pipeline_env(),
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert proc.stdout is not None
        span = PROGRESS_PIPELINE_END - PROGRESS_PIPELINE_START
        for line in proc.stdout:
            if line.startswith("COMPAS_PROGRESS"):
                _, pct, *msg = line.rstrip("\n").split(" ", 2)
                _write_progress(progress_file, PROGRESS_PIPELINE_START + span * float(pct) / 100.0, msg[0] if msg else "")
            elif line.startswith("COMPAS_ERROR"):
                error = line[len("COMPAS_ERROR"):].strip()
            else:
                log.write(line)
        rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"PFFDTD pipeline failed: {error or f'exit code {rc}'} (log: {log_path})")


def run_pffdtd_simulation(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter: Optional[list],
    object_materials_dict: dict,
    pairs_data: list,
    simulation_mode: str,
    fmax: float,
    ppw: float,
    duration: float,
    air_absorption: bool,
    simulation_name: str,
    rir_output_dir: str,
    temp_dir: str,
    mesh_settings: Optional[dict] = None,
) -> None:
    try:
        reason = pffdtd_available()
        if reason:
            raise RuntimeError(reason)

        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter,
            object_materials_dict, progress=lambda v, s: _write_progress(progress_file, min(v, PROGRESS_GEOMETRY_END), s),
        )
        geometry = {
            "vertices": inputs.vertices, "faces": inputs.faces,
            "object_face_ranges": inputs.object_face_ranges, "face_materials": inputs.face_materials,
        }
        _run_from_geometry(
            simulation_id, progress_file, result_file, geometry, pairs_data, simulation_mode, fmax, ppw,
            duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings,
            header_meta={"speckle_source": {"project_id": speckle_project_id, "version_id": speckle_version_id, "layer_name": layer_name}},
        )
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[pffdtd_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})


def _run_from_geometry(
    simulation_id, progress_file, result_file, geometry, pairs_data, simulation_mode, fmax, ppw,
    duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings, header_meta=None,
) -> None:
    """Shared by the Speckle entry point and tests (geometry given directly)."""
    _write_progress(progress_file, PROGRESS_GEOMETRY_END, "Preparing simulation mesh...")
    settings = MeshPrepSettings(**(mesh_settings or {})).model_copy(update={"merge_coplanar": False})
    seed_meta = seeds_from_pairs(pairs_data)
    mesh = SimulationMeshService.prepare(
        geometry["vertices"], geometry["faces"], geometry["object_face_ranges"], geometry["face_materials"],
        None, [s["position"] for s in seed_meta], MeshPrepOptions.from_settings(settings),
    )
    if len(mesh.faces) < 4:
        raise RuntimeError("No surfaces with a material assigned — nothing to simulate.")

    bmin, bmax = bounding_box(mesh)
    plan = plan_grid(bmax - bmin, fmax, ppw, duration)
    ctx = PreflightContext(
        engine=ENGINE_PFFDTD,
        seeds=[SeedMeta(**s) for s in seed_meta],
        pairs=[(str(p["source_id"]), str(p["receiver_id"])) for p in pairs_data],
        pffdtd_fmax=fmax, pffdtd_ppw=ppw, pffdtd_duration=duration,
    )
    analysis = SimulationPreflightService.analyze(mesh, ctx)
    errors = [i for i in analysis.issues if i.severity == "error" and i.code.startswith("pffdtd_")]
    if errors:
        raise RuntimeError("; ".join(f"{i.title}: {i.detail}" for i in errors))
    oblique = oblique_area_fraction(mesh.normals, mesh.areas)
    geometry_diagnostics = {
        **summarize(analysis.issues),
        "issues": [{"severity": i.severity, "code": i.code, "title": i.title} for i in analysis.issues if i.severity != "info"],
        "stats": {**mesh.stats, "air_volume_m3": mesh.air_volume_m3, "air_volume_method": mesh.air_volume_method},
    }

    # unique sources (in pair order) and receivers
    sources: "OrderedDict[str, list]" = OrderedDict()
    receivers: "OrderedDict[str, list]" = OrderedDict()
    for p in pairs_data:
        sources.setdefault(str(p["source_id"]), p["source_position"])
        receivers.setdefault(str(p["receiver_id"]), p["receiver_position"])
    foa = simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA

    mats_hash, materials = build_scene(mesh)
    work_dir = Path(PFFDTD_TEMP_DIR) / simulation_id
    work_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "work_dir": str(work_dir),
        "mats_hash": mats_hash,
        "materials": materials,
        "material_cache_dir": PFFDTD_MATERIAL_CACHE_DIR,
        "sources": list(sources.values()),
        "receivers": list(receivers.values()),
        "h": plan.h,
        "fmax": fmax,
        "duration": duration,
        "precision": PFFDTD_PRECISION,
        "foa": foa,
        "foa_offset_cells": PFFDTD_FOA_OFFSET_CELLS,
        "air_absorption": bool(air_absorption),
        "out_fs": AUDIO_SAMPLE_RATE,
        "lowcut_hz": PFFDTD_LOWCUT_HZ,
        "lowcut_order": PFFDTD_LOWCUT_ORDER,
        "lowpass_order": PFFDTD_LOWPASS_ORDER,
        "Tc": PFFDTD_TEMPERATURE_C,
        "rh": PFFDTD_RELATIVE_HUMIDITY,
    }
    job_path = work_dir / "job.json"
    job_path.write_text(json.dumps(job))
    print(
        f"[{simulation_id[:8]}] PFFDTD: {len(mesh.faces)} faces, {len(materials)} materials, "
        f"{len(sources)} source(s) x {len(receivers)} receiver(s), h={plan.h:.4f} m "
        f"(PPW {plan.ppw_effective:.1f} @ {fmax:.0f} Hz), grid {plan.shape}, ~{plan.est_runtime_s:.0f} s/source"
    )
    _write_progress(progress_file, PROGRESS_PIPELINE_START, "Starting GPU wave simulation...")
    _run_pipeline(job_path, progress_file)
    meta = json.loads((work_dir / "meta.json").read_text())

    _write_progress(progress_file, PROGRESS_PIPELINE_END, "Writing impulse responses...")
    rid_index = {rid: i for i, rid in enumerate(receivers)}
    sid_index = {sid: i for i, sid in enumerate(sources)}
    loaded: dict[int, np.ndarray] = {}
    ir_files, results = [], []
    rir_dir = Path(rir_output_dir)
    rir_dir.mkdir(parents=True, exist_ok=True)
    engine_meta = {
        "engine": "pffdtd",
        "fmax": fmax,
        "ppw_requested": ppw,
        "ppw_effective": plan.ppw_effective,
        "grid_spacing_m": plan.h,
        "grid_misalignment_cells": plan.misalignment_cells,
        "oblique_area_fraction": oblique,
        "band_limited": True,
        "precision": PFFDTD_PRECISION,
    }
    for p in pairs_data:
        sid, rid = str(p["source_id"]), str(p["receiver_id"])
        si = sid_index[sid]
        if si not in loaded:
            loaded[si] = np.load(work_dir / f"src_{si}.npz")["irs"]
        ir = loaded[si][rid_index[rid]]  # [C, N]
        data = ir[0] if not foa else ir.T
        filename = f"pffdtd_{simulation_id}_src_{sid}_rcv_{rid}.wav"
        wavfile.write(str(rir_dir / filename), AUDIO_SAMPLE_RATE, np.ascontiguousarray(data, dtype=np.float32))
        ir_files.append(filename)
        entry = {
            "source_id": sid, "receiver_id": rid,
            "source_position": p["source_position"], "receiver_position": p["receiver_position"],
            "ir_file": filename, "sample_rate": AUDIO_SAMPLE_RATE, "simulation_mode": simulation_mode,
            "num_channels": 4 if foa else 1, "air_absorption": bool(air_absorption), **engine_meta,
        }
        if foa:
            entry.update({"channel_ordering": "ACN", "normalization_convention": "SN3D", "format": "AmbiX",
                          "encoding_method": "pressure_gradient", "channel_names": CHANNELS_FOA})
        try:
            params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(ir[0].astype(np.float64), AUDIO_SAMPLE_RATE)
            if params:
                entry["acoustic_parameters"] = params
        except Exception as exc:
            print(f"  Warning: acoustic params failed for {sid}->{rid}: {exc}")
        results.append(entry)

    results_filename = f"pffdtd_{simulation_id}_results.json"
    results_json = {
        "simulation_id": simulation_id,
        "simulation_name": simulation_name,
        "method": "PFFDTD",
        "results": results,
        "grid": {**plan.as_dict(), "runs": meta.get("sources", [])},
        "geometry_diagnostics": geometry_diagnostics,
        **(header_meta or {}),
    }
    with open(Path(temp_dir) / results_filename, "w") as f:
        json.dump(results_json, f, indent=2)

    _atomic_write(result_file, {
        "type": "done",
        "result": {
            "simulation_id": simulation_id,
            "message": f"PFFDTD simulation completed ({len(ir_files)} IR file(s), band-limited to {fmax:.0f} Hz)",
            "ir_files": ir_files,
            "results_file": results_filename,
            "method": "PFFDTD",
        },
    })


def run_pffdtd_simulation_from_geometry(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    geometry: dict,
    pairs_data: list,
    simulation_mode: str,
    fmax: float,
    ppw: float,
    duration: float,
    air_absorption: bool,
    simulation_name: str,
    rir_output_dir: str,
    temp_dir: str,
    mesh_settings: Optional[dict] = None,
) -> None:
    """Direct-geometry entry point (vertices/faces/object_face_ranges/face_materials), used by tests."""
    try:
        reason = pffdtd_available()
        if reason:
            raise RuntimeError(reason)
        _run_from_geometry(
            simulation_id, progress_file, result_file, geometry, pairs_data, simulation_mode, fmax, ppw,
            duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings,
        )
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[pffdtd_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})
