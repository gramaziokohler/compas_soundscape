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
import shutil
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
    PFFDTD_ANIM_BASE_DIR_NAME,
    PFFDTD_DEFAULT_FREE_MODE,
    PFFDTD_ENGINE_EXE,
    PFFDTD_FIELD_DIR,
    PFFDTD_FIELD_MAX_PX,
    PFFDTD_FOA_OFFSET_CELLS,
    PFFDTD_FREE_GRID_SPACING_DEFAULT,
    PFFDTD_IR_REFERENCE_GAIN,
    PFFDTD_LOWCUT_HZ,
    PFFDTD_LOWCUT_ORDER,
    PFFDTD_LOWPASS_ORDER,
    PFFDTD_MATERIAL_CACHE_DIR,
    PFFDTD_PIPELINE_SCRIPT,
    PFFDTD_PRECISION,
    PFFDTD_PYTHON,
    PFFDTD_RELATIVE_HUMIDITY,
    PFFDTD_SPL_REFERENCE_M,
    PFFDTD_SPL_VOLUME_MAX_NODES,
    PFFDTD_SPL_VOLUME_STRIDE,
    PFFDTD_TEMP_DIR,
    PFFDTD_TEMPERATURE_C,
    PFFDTD_VOXEL_CACHE_DIR,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
)
from models.schemas import MeshPrepSettings
from services.pffdtd_free import FreeOptions, job_block as free_job_block, reset_store as reset_free_store, results_block as free_results_block
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


def _write_progress(progress_file: str, value: float, status: str, partial: Optional[dict] = None) -> None:
    """``partial`` (pipeline milestones, e.g. {"voxelised": true}) becomes the job's ``partial``."""
    payload: dict = {"value": int(value), "status": status}
    if partial:
        payload["partial"] = partial
    _atomic_write(progress_file, payload)


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
        value, status = float(PROGRESS_PIPELINE_START), ""
        stages: dict = {}  # COMPAS_STAGE milestones, sticky for the rest of the run
        for line in proc.stdout:
            if line.startswith("COMPAS_PROGRESS"):
                _, pct, *msg = line.rstrip("\n").split(" ", 2)
                value, status = PROGRESS_PIPELINE_START + span * float(pct) / 100.0, msg[0] if msg else ""
                _write_progress(progress_file, value, status, stages)
            elif line.startswith("COMPAS_STAGE"):
                name, _, raw = line[len("COMPAS_STAGE"):].strip().partition(" ")
                stages[name] = json.loads(raw) if raw else True
                _write_progress(progress_file, value, status, stages)
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
    field_plane_z: Optional[float] = None,
    free_mode: str = PFFDTD_DEFAULT_FREE_MODE,
    free_grid_spacing: float = PFFDTD_FREE_GRID_SPACING_DEFAULT,
) -> None:
    try:
        reason = pffdtd_available()
        if reason:
            raise RuntimeError(reason)

        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter,
            object_materials_dict, progress=lambda v, s: _write_progress(progress_file, min(v, PROGRESS_GEOMETRY_END), s),
        )
        _run_from_geometry(
            simulation_id, progress_file, result_file, geometry_dict(inputs), pairs_data, simulation_mode, fmax, ppw,
            duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings,
            FieldOptions(field_plane_z),
            header_meta={"speckle_source": {"project_id": speckle_project_id, "version_id": speckle_version_id, "layer_name": layer_name}},
            free=FreeOptions(free_mode, free_grid_spacing),
        )
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[pffdtd_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})


class FieldOptions:
    """Field outputs of a run: the strength-G volume and the default plane (mask) at plane_z.

    Wave animations are generated on demand afterwards (services/pffdtd_animation_job.py).
    """

    def __init__(self, plane_z: Optional[float] = None):
        self.plane_z = plane_z


def geometry_dict(inputs) -> dict:
    return {
        "vertices": inputs.vertices, "faces": inputs.faces,
        "object_face_ranges": inputs.object_face_ranges, "face_materials": inputs.face_materials,
    }


def prepare_pffdtd_mesh(geometry: dict, pairs_data: list, mesh_settings: Optional[dict]):
    """Same mesh preparation as the preflight (merge_coplanar off: PFFDTD voxelises triangles as-is).

    Returns (mesh, seed_meta); shared by the simulation and the voxel preview.
    """
    settings = MeshPrepSettings(**(mesh_settings or {})).model_copy(update={"merge_coplanar": False})
    seed_meta = seeds_from_pairs(pairs_data)
    mesh = SimulationMeshService.prepare(
        geometry["vertices"], geometry["faces"], geometry["object_face_ranges"], geometry["face_materials"],
        None, [s["position"] for s in seed_meta], MeshPrepOptions.from_settings(settings),
    )
    if len(mesh.faces) < 4:
        raise RuntimeError("No surfaces with a material assigned — nothing to simulate.")
    return mesh, seed_meta


def unique_seeds(pairs_data: list) -> tuple["OrderedDict[str, list]", "OrderedDict[str, list]"]:
    """Unique sources and receivers (in pair order) -> position."""
    sources: "OrderedDict[str, list]" = OrderedDict()
    receivers: "OrderedDict[str, list]" = OrderedDict()
    for p in pairs_data:
        sources.setdefault(str(p["source_id"]), p["source_position"])
        receivers.setdefault(str(p["receiver_id"]), p["receiver_position"])
    return sources, receivers


def run_pipeline_job(job: dict, work_dir: Path, progress_file: str) -> None:
    job_path = work_dir / "job.json"
    job_path.write_text(json.dumps(job))
    _run_pipeline(job_path, progress_file)


def _run_from_geometry(
    simulation_id, progress_file, result_file, geometry, pairs_data, simulation_mode, fmax, ppw,
    duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings,
    field: Optional[FieldOptions] = None, header_meta=None, free: Optional[FreeOptions] = None,
) -> None:
    """Shared by the Speckle entry point and tests (geometry given directly)."""
    field = field or FieldOptions()
    free = free or FreeOptions()
    _write_progress(progress_file, PROGRESS_GEOMETRY_END, "Preparing simulation mesh...")
    mesh, seed_meta = prepare_pffdtd_mesh(geometry, pairs_data, mesh_settings)

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

    sources, receivers = unique_seeds(pairs_data)
    foa = simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA
    plane_z = field.plane_z if field.plane_z is not None else float(np.mean([r[2] for r in receivers.values()]))
    if free.reciprocal:
        plane_z = None  # free source: the runs are from the listeners -- no per-source field outputs

    mats_hash, materials = build_scene(mesh)
    work_dir = Path(PFFDTD_TEMP_DIR) / simulation_id
    work_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "work_dir": str(work_dir),
        "mats_hash": mats_hash,
        "materials": materials,
        "material_cache_dir": PFFDTD_MATERIAL_CACHE_DIR,
        "voxel_cache_dir": PFFDTD_VOXEL_CACHE_DIR,
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
        "plane_z": plane_z,
        "field_max_px": PFFDTD_FIELD_MAX_PX,
        "spl_reference_m": PFFDTD_SPL_REFERENCE_M,
        "spl_volume_stride": PFFDTD_SPL_VOLUME_STRIDE,
        "spl_volume_max_nodes": PFFDTD_SPL_VOLUME_MAX_NODES,
        "anim_base_dir": PFFDTD_ANIM_BASE_DIR_NAME,
    }
    if free.enabled:
        reset_free_store(simulation_id)
        job["free"] = free_job_block(simulation_id, free)
    print(
        f"[{simulation_id[:8]}] PFFDTD: {len(mesh.faces)} faces, {len(materials)} materials, "
        f"{len(sources)} source(s) x {len(receivers)} receiver(s), h={plan.h:.4f} m "
        f"(PPW {plan.ppw_effective:.1f} @ {fmax:.0f} Hz), grid {plan.shape}, ~{plan.est_runtime_s:.0f} s/source"
    )
    _write_progress(progress_file, PROGRESS_PIPELINE_START, "Starting GPU wave simulation...")
    run_pipeline_job(job, work_dir, progress_file)
    meta = json.loads((work_dir / "meta.json").read_text())
    field_block = _collect_field_outputs(simulation_id, work_dir, meta, list(sources), fmax)

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
        "ir_reference": "free field at 1 m (direct path 1/r, as pyroomacoustics)",
        "precision": PFFDTD_PRECISION,
    }
    for p in pairs_data:
        sid, rid = str(p["source_id"]), str(p["receiver_id"])
        si = sid_index[sid]
        if si not in loaded:
            loaded[si] = np.load(work_dir / f"src_{si}.npz")["irs"]
        ir = loaded[si][rid_index[rid]] * PFFDTD_IR_REFERENCE_GAIN  # [C, N], re free field at 1 m
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
        "field": field_block,
        "free": free_results_block(simulation_id, meta["free"], list(sources), list(receivers)) if meta.get("free") else None,
        "geometry_diagnostics": geometry_diagnostics,
        **(header_meta or {}),
    }
    with open(Path(temp_dir) / results_filename, "w") as f:
        json.dump(results_json, f, indent=2)
    # everything else is now in rir_output_dir / PFFDTD_FIELD_DIR / the results JSON; the rest of
    # the work folder (GPU data, raw outputs) can be GBs. Only the animation base (voxelisation +
    # prepared run) stays, for on-demand wave animations, until the temp janitor
    # (TEMP_JANITOR_MAX_AGE_H) removes it with the results. Failed or cancelled runs keep the whole
    # folder for diagnosis until then.
    prune_work_dir(work_dir)

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


def prune_work_dir(work_dir: Path) -> None:
    """Delete everything in a finished run's work folder but the animation base."""
    for entry in Path(work_dir).iterdir():
        if entry.name == PFFDTD_ANIM_BASE_DIR_NAME:
            continue
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)


def _collect_field_outputs(simulation_id: str, work_dir: Path, meta: dict, source_ids: list, fmax: float) -> Optional[dict]:
    """Move the field binaries to PFFDTD_FIELD_DIR and describe them for the frontend.

    All binaries are little-endian and row-major. Mask values: 0 air, 1 wall, 2 outside.
    - ``volume``: strength G (float32 dB, NaN outside) per source and a mask (uint8), both
      [nz, ny, nx] (z outer, x inner). Node (ix, iy, iz) sits at (x0 + ix*dx, y0 + iy*dy, z0 + iz*dz)
      and stands for the stride^3 block of grid nodes around it.
    - top level (the animation plane at height z; the mean listener height until an animation is
      generated): mask uint8 [ny, nx] and animation int8 [frames, ny, nx] (value = q / 127 * vmax).
      Node (ix, iy) sits at (x0 + ix*dx, y0 + iy*dy, z). Animations are generated on demand
      (``animation_on_demand``; services/pffdtd_animation_job.py rewrites this block).
      ``sources[].spl_file`` (a strength-G map on this plane) exists only in results written
      before the volume; it is null now.
    """
    plane, volume = meta.get("plane"), meta.get("volume")
    if not plane or not volume:
        return None
    out_dir = Path(PFFDTD_FIELD_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    def move(name: str, target: str) -> str:
        shutil.move(str(work_dir / name), str(out_dir / target))
        return target

    prefix = f"pffdtd_{simulation_id}_"
    sources, volume_sources = [], []
    for si, run in enumerate(meta["sources"]):
        sid = source_ids[si]
        spl = run.get("spl") or {}
        sources.append({
            "source_id": sid,
            "spl_file": None,
            "spl_min_db": spl.get("min_db"),
            "spl_max_db": spl.get("max_db"),
            "animation": None,
        })
        volume_sources.append({
            "source_id": sid,
            "spl_volume_file": move(spl["volume_file"], f"{prefix}spl_vol_src_{sid}.f32") if spl.get("volume_file") else None,
        })
    return {
        "z": plane["z"], "x0": plane["x0"], "y0": plane["y0"], "dx": plane["dx"], "dy": plane["dy"],
        "nx": plane["nx"], "ny": plane["ny"],
        "mask_file": move(plane["mask_file"], f"{prefix}plane_mask.u8"),
        "band_hz": [PFFDTD_LOWCUT_HZ, fmax],
        "reference": f"Strength G: dB re the same source in free field at {volume['reference_m']:g} m",
        "air_absorption_applied": False,
        "animation_on_demand": True,
        "sources": sources,
        "volume": {
            "x0": volume["x0"], "y0": volume["y0"], "z0": volume["z0"],
            "dx": volume["dx"], "dy": volume["dy"], "dz": volume["dz"],
            "nx": volume["nx"], "ny": volume["ny"], "nz": volume["nz"], "stride": volume["stride"],
            "mask_file": move(volume["mask_file"], f"{prefix}volume_mask.u8"),
            "sources": volume_sources,
        },
    }


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
    field_plane_z: Optional[float] = None,
    free_mode: str = PFFDTD_DEFAULT_FREE_MODE,
    free_grid_spacing: float = PFFDTD_FREE_GRID_SPACING_DEFAULT,
) -> None:
    """Direct-geometry entry point (vertices/faces/object_face_ranges/face_materials), used by tests."""
    try:
        reason = pffdtd_available()
        if reason:
            raise RuntimeError(reason)
        _run_from_geometry(
            simulation_id, progress_file, result_file, geometry, pairs_data, simulation_mode, fmax, ppw,
            duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings,
            FieldOptions(field_plane_z), free=FreeOptions(free_mode, free_grid_spacing),
        )
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[pffdtd_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})
