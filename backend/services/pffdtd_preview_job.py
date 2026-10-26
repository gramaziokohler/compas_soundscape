"""
PFFDTD voxel preview -- runs in a CPU-worker child process (variant "pffdtd_voxel_preview").

Same inputs and mesh preparation as the simulation (services/pffdtd_job.py), then the
compas-pffdtd pipeline in ``voxel_preview`` mode: voxelise only (no materials fit, no GPU)
and check the grid (seed clearance / clashes, leaks, unreachable listeners, materials lost
to thin geometry, voxeliser stability). Writes into the caller's workspace folder:

    pffdtd_preview_<id>.json   grid, material legend, problems (positions for the viewer)
    pffdtd_preview_<id>.bin    float32 [N, 3] boundary-node positions + uint8 [N] material (255 = rigid)
"""
from __future__ import annotations

import json
import os
import shutil
import traceback
from pathlib import Path
from typing import Optional

from config.constants import (
    PFFDTD_DEFAULT_DURATION,
    PFFDTD_PREVIEW_MAX_LABEL_NODES,
    PFFDTD_PREVIEW_MAX_LEAK_POINTS,
    PFFDTD_PREVIEW_MAX_POINTS,
    PFFDTD_SEED_CLEARANCE_CELLS,
    PFFDTD_TEMP_DIR,
    PFFDTD_VOXEL_CACHE_DIR,
)
from services.pffdtd_job import (
    _atomic_write,
    _write_progress,
    geometry_dict,
    pffdtd_available,
    prepare_pffdtd_mesh,
    run_pipeline_job,
    unique_seeds,
)
from services.pffdtd_scene_export import bounding_box, build_scene, scene_material_ids
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from utils.pffdtd_grid import plan_grid

PROGRESS_GEOMETRY_END = 15


def preview_paths(payload_dir: str, preview_id: str) -> tuple[Path, Path]:
    base = Path(payload_dir) / f"pffdtd_preview_{preview_id}"
    return base.with_suffix(".json"), base.with_suffix(".bin")


def run_pffdtd_voxel_preview(
    preview_id: str,
    progress_file: str,
    result_file: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter: Optional[list],
    object_materials_dict: dict,
    pairs_data: list,
    fmax: float,
    ppw: float,
    payload_dir: str,
    mesh_settings: Optional[dict] = None,
) -> None:
    try:
        reason = pffdtd_available()
        if reason:
            raise RuntimeError(reason)
        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter, object_materials_dict,
            progress=lambda v, s: _write_progress(progress_file, min(v, PROGRESS_GEOMETRY_END), s),
        )
        run_voxel_preview_from_geometry(
            preview_id, progress_file, result_file, geometry_dict(inputs), pairs_data, fmax, ppw, payload_dir, mesh_settings,
        )
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[pffdtd_preview] Error [{preview_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})


def run_voxel_preview_from_geometry(
    preview_id: str,
    progress_file: str,
    result_file: str,
    geometry: dict,
    pairs_data: list,
    fmax: float,
    ppw: float,
    payload_dir: str,
    mesh_settings: Optional[dict] = None,
) -> None:
    """Direct-geometry entry point (also used by tests); raises on failure."""
    _write_progress(progress_file, PROGRESS_GEOMETRY_END, "Preparing simulation mesh...")
    mesh, _ = prepare_pffdtd_mesh(geometry, pairs_data, mesh_settings)
    bmin, bmax = bounding_box(mesh)
    plan = plan_grid(bmax - bmin, fmax, ppw, PFFDTD_DEFAULT_DURATION)
    if not plan.fits_gpu:
        raise RuntimeError(
            f"Grid does not fit in GPU memory ({plan.nodes / 1e6:.0f} M nodes, {plan.gpu_bytes / 1e9:.1f} GB of "
            f"{plan.gpu_budget_bytes / 1e9:.1f} GB). Lower the max frequency or the points per wavelength."
        )
    mats_hash, _ = build_scene(mesh)
    material_ids = scene_material_ids(mesh)
    sources, receivers = unique_seeds(pairs_data)

    work_dir = Path(PFFDTD_TEMP_DIR) / f"preview_{preview_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        run_pipeline_job({
            "mode": "voxel_preview",
            "work_dir": str(work_dir),
            "mats_hash": mats_hash,
            "voxel_cache_dir": PFFDTD_VOXEL_CACHE_DIR,
            "material_labels": material_ids,
            "sources": list(sources.values()),
            "receivers": list(receivers.values()),
            "source_ids": list(sources),
            "receiver_ids": list(receivers),
            "h": plan.h,
            "clearance_cells": PFFDTD_SEED_CLEARANCE_CELLS,
            "preview_max_points": PFFDTD_PREVIEW_MAX_POINTS,
            "preview_max_label_nodes": PFFDTD_PREVIEW_MAX_LABEL_NODES,
            "max_leak_points": PFFDTD_PREVIEW_MAX_LEAK_POINTS,
        }, work_dir, progress_file)

        preview = json.loads((work_dir / "preview.json").read_text())
        for m in preview["materials"]:
            m["material_id"] = material_ids.get(m["name"])
        preview["preview_id"] = preview_id
        preview["grid"].update({
            "ppw_effective": plan.ppw_effective,
            "gpu_memory_gb": plan.gpu_bytes / 1e9,
            "est_runtime_s_per_source": plan.est_runtime_s,
        })
        counts = {
            "n_errors": sum(p["severity"] == "error" for p in preview["problems"]),
            "n_warnings": sum(p["severity"] == "warning" for p in preview["problems"]),
        }
        preview.update(counts)

        json_path, bin_path = preview_paths(payload_dir, preview_id)
        os.makedirs(payload_dir, exist_ok=True)
        shutil.move(str(work_dir / "points.bin"), str(bin_path))
        tmp = str(json_path) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(preview, f, separators=(",", ":"))
        os.replace(tmp, json_path)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    print(f"[pffdtd_preview {preview_id[:8]}] grid {preview['grid']['shape']}, {preview['grid']['boundary_nodes']} boundary nodes, {counts}")
    _atomic_write(result_file, {"type": "done", "result": {"preview_id": preview_id, **counts, "payload_file": json_path.name}})
