"""On-demand wave animation of a finished PFFDTD simulation (runs inside the compas-pffdtd env).

A simulation job gathers what an animation run needs into one folder (``save_base``): the
voxelisation (setup/), the prepared run (pickled, without its accumulation lattice) and the
strength-G lattice with its "outside" cells. services/pffdtd_job.py deletes the rest of the
work folder; the temp janitor removes this one with the simulation's other results.

``run_animation`` (pipeline mode ``"animation"``) derives one short run per source from that
voxelisation: a one-cycle sine pulse, snapshots of the horizontal plane at ``plane_z`` only.
It writes field_src_<i>.i8, plane_mask.u8 and anim_meta.json into ``out_dir``.
"""

from __future__ import annotations

import json
import pickle
import shutil
from dataclasses import replace
from pathlib import Path
from typing import Callable

import numpy as np

from pffdtd_backend.engine import run_engine
from pffdtd_backend.fields import pulse, quantize_frames, snapshot_steps
from pffdtd_backend.outputs import (
    PLANE_AIR,
    PLANE_OUTSIDE,
    PLANE_WALL,
    OutputLattice,
    OutputPlane,
    plane_nodes,
    read_snapshots,
)
from pffdtd_backend.sim_prepare import PreparedSim, derive

BASE_FILE = "base.pkl"
OUTSIDE_FILE = "outside.npy"
SETUP_SUBDIR = "setup"
META_FILE = "anim_meta.json"
PLANE_MASK_FILE = "plane_mask.u8"


def save_base(base_dir: Path, base: PreparedSim, lattice: OutputLattice, outside: np.ndarray) -> None:
    """Move the voxelisation into base_dir and pickle the prepared run + lattice next to it.

    Call after the last run that uses ``base``; the large accumulation index list is dropped.
    """
    base_dir = Path(base_dir)
    shutil.rmtree(base_dir, ignore_errors=True)
    base_dir.mkdir(parents=True)
    setup_dir = base_dir / SETUP_SUBDIR
    shutil.move(str(base.setup_dir), str(setup_dir))
    base = replace(base, setup_dir=setup_dir, gpu_dir=base_dir / "gpu",
                   spec=replace(base.spec, plane_ixyz=None, acc_sos=None, snapshot_steps=[]))
    lattice = replace(lattice, ixyz=np.zeros(0, np.int64))
    with open(base_dir / BASE_FILE, "wb") as f:
        pickle.dump({"base": base, "lattice": lattice}, f)
    np.save(base_dir / OUTSIDE_FILE, outside)


def has_base(base_dir: Path) -> bool:
    base_dir = Path(base_dir)
    return (base_dir / BASE_FILE).exists() and (base_dir / OUTSIDE_FILE).exists() and (base_dir / SETUP_SUBDIR).is_dir()


def plane_mask(plane: OutputPlane, lattice: OutputLattice, outside: np.ndarray) -> np.ndarray:
    """[ny, nx] uint8: the plane's own walls; outside taken from the nearest lattice node."""
    Y, X = np.meshgrid(plane.y, plane.x, indexing="ij")
    kz, ky, kx = lattice.nearest(X, Y, np.full(X.shape, plane.z))
    mask = np.full((plane.ny, plane.nx), PLANE_AIR, np.uint8)
    mask[outside[kz, ky, kx]] = PLANE_OUTSIDE
    mask[plane.walls] = PLANE_WALL
    return mask


def run_animation(job: dict, watch, emit: Callable[[float, str], None], voxel_check: Callable, bn_ixyz: Callable) -> dict:
    """Animation frames for every source on the plane at job["plane_z"]; returns the meta."""
    base_dir = Path(job["base_dir"])
    out_dir = Path(job["out_dir"])
    if not has_base(base_dir):
        raise RuntimeError("The simulation's voxel grid has expired; re-run the simulation to animate it.")
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)

    emit(2, "Loading the voxel grid...")
    with open(base_dir / BASE_FILE, "rb") as f:
        saved = pickle.load(f)
    base: PreparedSim = saved["base"]
    lattice: OutputLattice = saved["lattice"]
    outside = np.load(base_dir / OUTSIDE_FILE)
    plane = plane_nodes(base.xv, base.yv, base.zv, bn_ixyz(base), float(job["plane_z"]), int(job["field_max_px"]))
    plane_mask(plane, lattice, outside).tofile(out_dir / PLANE_MASK_FILE)

    fmax = float(job["fmax"])
    animation_s = float(job["animation_s"])
    sources = job["sources"]
    meta = {"plane": {**plane.as_dict(), "mask_file": PLANE_MASK_FILE}, "sources": []}
    for si, src in enumerate(sources):
        pct0 = 5 + 90 * si / len(sources)
        emit(pct0, f"Source {si + 1}/{len(sources)}: preparing the pulse run...")
        anim = voxel_check(
            derive, base, out_dir / f"run_{si}", source_xyz=src, duration=animation_s,
            source_signal=pulse(fmax), snapshot_steps=snapshot_steps(int(np.ceil(animation_s / base.Ts)), int(job["anim_frames"])),
            plane_ixyz=plane.ixyz, acc_sos=None,
        )

        def on_progress(pct, elapsed, eta, pct0=pct0, si=si):
            emit(pct0 + 90 / len(sources) * pct / 100.0, f"Source {si + 1}/{len(sources)}: wave animation {pct:.0f}%")

        run_engine(anim.gpu_dir, job["precision"], on_progress=on_progress, should_stop=lambda: watch.dead)
        snaps = read_snapshots(anim)
        frames, vmax = quantize_frames(np.stack([u for _, u in snaps]))
        frames.tofile(out_dir / f"field_src_{si}.i8")
        meta["sources"].append({
            "index": si, "file": f"field_src_{si}.i8", "frames": len(snaps), "vmax": vmax,
            "times_ms": [round(n * anim.Ts * 1e3, 4) for n, _ in snaps],
        })
        shutil.rmtree(anim.spec.sim_dir, ignore_errors=True)

    (out_dir / META_FILE).write_text(json.dumps(meta))
    emit(100, "Done")
    return meta
