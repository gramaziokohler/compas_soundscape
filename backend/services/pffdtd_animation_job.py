"""
On-demand PFFDTD wave animation -- runs as a child of workers/pffdtd_runner.py (compas-toy env),
job type "pffdtd_animation" on the pffdtd queue.

A finished simulation keeps its voxelisation and prepared run in
<PFFDTD_TEMP_DIR>/<simulation_id>/<PFFDTD_ANIM_BASE_DIR_NAME> (services/pffdtd_job.py). This job
runs the compas-pffdtd pipeline in ``animation`` mode on it: one short band-limited pulse run per
source, snapshots of the horizontal plane at ``plane_z`` only (no voxelisation, no IR). The
frames and the plane mask go to PFFDTD_FIELD_DIR under fresh names (no stale browser cache), the
results JSON ``field`` block is rewritten to that plane, and the previous animation's files are
deleted.

Progress file: {"value": 0-100, "status": "<human text>"}
Result file:   {"type": "done", "result": {"simulation_id", "z", "message"}}
            or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import json
import shutil
import traceback
import uuid
from pathlib import Path

from config.constants import (
    PFFDTD_ANIM_BASE_DIR_NAME,
    PFFDTD_ANIM_FRAMES,
    PFFDTD_FIELD_DIR,
    PFFDTD_FIELD_MAX_PX,
    PFFDTD_PRECISION,
    PFFDTD_TEMP_DIR,
)
from services.pffdtd_job import _atomic_write, _write_progress, pffdtd_available, run_pipeline_job

EXPIRED = "The simulation's voxel grid has expired; re-run the simulation to animate it."


def results_json_path(temp_dir: str, simulation_id: str) -> Path:
    return Path(temp_dir) / f"pffdtd_{simulation_id}_results.json"


def run_pffdtd_animation(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    plane_z: float,
    animation_ms: float,
    temp_dir: str,
) -> None:
    try:
        reason = pffdtd_available()
        if reason:
            raise RuntimeError(reason)
        results_path = results_json_path(temp_dir, simulation_id)
        if not results_path.exists():
            raise RuntimeError("The simulation results have expired; re-run the simulation.")
        results = json.loads(results_path.read_text())
        field = results.get("field") or {}
        if not field.get("animation_on_demand"):
            raise RuntimeError("This simulation predates on-demand wave animations; re-run it to animate.")
        sim_dir = Path(PFFDTD_TEMP_DIR) / simulation_id
        base_dir = sim_dir / PFFDTD_ANIM_BASE_DIR_NAME
        if not base_dir.is_dir():
            raise RuntimeError(EXPIRED)

        positions = {str(e["source_id"]): e["source_position"] for e in results["results"]}
        source_ids = [str(s["source_id"]) for s in field["sources"]]
        run_dir = sim_dir / f"anim_run_{uuid.uuid4().hex[:8]}"
        run_dir.mkdir(parents=True)
        out_dir = run_dir / "out"
        job = {
            "mode": "animation",
            "base_dir": str(base_dir),
            "out_dir": str(out_dir),
            "sources": [positions[sid] for sid in source_ids],
            "fmax": float(field["band_hz"][1]),
            "precision": PFFDTD_PRECISION,
            "plane_z": float(plane_z),
            "field_max_px": PFFDTD_FIELD_MAX_PX,
            "animation_s": float(animation_ms) / 1000.0,
            "anim_frames": PFFDTD_ANIM_FRAMES,
        }
        _write_progress(progress_file, 5, "Starting the wave animation...")
        try:
            run_pipeline_job(job, run_dir, progress_file)
            meta = json.loads((out_dir / "anim_meta.json").read_text())
            new_field, stale = _publish(simulation_id, field, source_ids, out_dir, meta)
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)

        results["field"] = new_field
        _atomic_write(str(results_path), results)
        for name in stale:
            (Path(PFFDTD_FIELD_DIR) / name).unlink(missing_ok=True)

        _atomic_write(result_file, {
            "type": "done",
            "result": {
                "simulation_id": simulation_id,
                "z": new_field["z"],
                "message": f"Wave animation recorded at z = {new_field['z']:.2f} m",
            },
        })
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[pffdtd_animation_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})


def _publish(simulation_id: str, field: dict, source_ids: list, out_dir: Path, meta: dict) -> tuple[dict, list]:
    """Move the frames + mask to PFFDTD_FIELD_DIR; returns (new field block, stale file names)."""
    field_dir = Path(PFFDTD_FIELD_DIR)
    field_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"pffdtd_{simulation_id}_anim{uuid.uuid4().hex[:8]}_"

    def move(name: str, target: str) -> str:
        shutil.move(str(out_dir / name), str(field_dir / f"{prefix}{target}"))
        return f"{prefix}{target}"

    stale = [field["mask_file"]] + [s["animation"]["file"] for s in field["sources"] if s.get("animation")]
    plane = meta["plane"]
    sources = []
    for src, anim in zip(field["sources"], meta["sources"]):
        sid = str(src["source_id"])
        sources.append({
            **src,
            "animation": {
                "file": move(anim["file"], f"field_src_{sid}.i8"),
                "frames": anim["frames"], "times_ms": anim["times_ms"], "vmax": anim["vmax"],
            },
        })
    new_field = {
        **field,
        "z": plane["z"], "x0": plane["x0"], "y0": plane["y0"], "dx": plane["dx"], "dy": plane["dy"],
        "nx": plane["nx"], "ny": plane["ny"],
        "mask_file": move(plane["mask_file"], "plane_mask.u8"),
        "sources": sources,
    }
    assert [s["source_id"] for s in sources] == source_ids
    return new_field, [name for name in stale if name]
