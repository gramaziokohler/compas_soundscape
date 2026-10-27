"""Free-positioning and reciprocal runs -- runs inside the compas-pffdtd env.

Free listener (``job["free"]["mode"] == "listener"``): pipeline.run_job runs one engine run per
source as usual; every run also records the candidate grid (``make_grid``) as node receivers,
streamed into the raw store (``free_ir`` module docstring) with ``store_run``.

Reciprocal (``run_reciprocal``): runs per fixed listener -- a monopole at the listener (and, for
an FOA listener, a +/- pair per axis). The real sources are the runs' receivers, so the
configured pairs' IRs come out by reciprocity (written as src_<i>.npz like a forward job). Used by

* free source (``mode: "source"``): the grid records where a moved source can go;
* directional sources (``job["reciprocal"]``, ``job["source_directivities"]``): a directional
  source is a 7-probe receiver set and its first-order pattern per octave band is composed from
  the probes (pffdtd_backend/directional.py); omni sources keep a single probe.

No strength-G volume or animation in either case.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Callable

import numpy as np

from pffdtd_backend.directional import compose, probe_row_ranges
from pffdtd_backend.engine import run_engine
from pffdtd_backend.free_grid import FreeGrid, candidate_grid
from pffdtd_backend.free_ir import AXES, FREE_META, FREE_POINTS, dipole_points, reciprocal_channels, run_file, to_wav_ir
from pffdtd_backend.outputs import read_receivers, stream_node_receivers
from pffdtd_backend.postprocess import foa_channels, probe_positions
from pffdtd_backend.sim_prepare import PreparedSim, SimSpec, derive, job_domain_bounds, prepare

# grid points whose centre-probe energy is this far below the run's maximum received nothing
OUTSIDE_ENERGY_RATIO = 1e-10


def post_params(job: dict) -> dict:
    """to_ir parameters of the job (``gain`` = the WAV reference gain applied by the worker)."""
    return {
        "fmax": float(job["fmax"]), "out_fs": float(job["out_fs"]), "duration": float(job["duration"]),
        "lowcut_hz": float(job["lowcut_hz"]), "lowcut_order": int(job["lowcut_order"]),
        "lowpass_order": int(job["lowpass_order"]), "air_absorption": bool(job["air_absorption"]),
        "Tc": float(job["Tc"]), "rh": float(job["rh"]), "gain": float((job.get("free") or {}).get("ir_gain", 1.0)),
    }


def make_grid(job: dict, base: PreparedSim, seeds, n_probe: int, n_runs: int) -> FreeGrid:
    import h5py

    free = job["free"]
    with h5py.File(base.setup_dir / "vox_out.h5", "r") as f:
        bn = f["bn_ixyz"][...]
    pts = np.concatenate([np.asarray(m["pts"], np.float64) for m in job["mats_hash"].values()])
    grid = candidate_grid(
        base.xv, base.yv, base.zv, bn, pts.min(axis=0), pts.max(axis=0), seeds,
        spacing_m=float(free["spacing_m"]), clearance_m=float(free["clearance_cells"]) * base.h,
        n_probe=n_probe, Nt=base.Nt, n_runs=n_runs,
        max_record_bytes=float(free["max_record_bytes"]), max_disk_bytes=float(free["max_disk_bytes"]),
        max_label_nodes=int(free["max_label_nodes"]),
    )
    if grid.n_points == 0:
        raise RuntimeError("Free positioning: no grid point is far enough from the surfaces; lower the spacing or turn it off.")
    return grid


def store_run(prep: PreparedSim, grid: FreeGrid, free_dir: Path, k: int) -> np.ndarray:
    """Stream run k's node receivers into the raw store; returns the per-point energy."""
    free_dir.mkdir(parents=True, exist_ok=True)
    energy, _ = stream_node_receivers(prep.gpu_dir, grid.n_probe, free_dir / run_file(k))
    return energy


def write_store(free_dir: Path, job: dict, grid: FreeGrid, energies: list, runs: list, prep: PreparedSim, offset_m: float) -> dict:
    """free.json + free_points.bin; returns the summary for meta.json."""
    valid = np.zeros(grid.n_points, bool)
    for e in energies:
        valid |= e > OUTSIDE_ENERGY_RATIO * max(float(e.max()), 0.0)
    with open(free_dir / FREE_POINTS, "wb") as f:
        f.write(grid.xyz.astype(np.float32).tobytes())
        f.write(valid.astype(np.uint8).tobytes())
    summary = {
        "mode": job["free"]["mode"], "foa": bool(job["foa"]), "n_points": grid.n_points, "n_valid": int(valid.sum()),
        "n_probe": grid.n_probe, "spacing_m": grid.spacing_m, "requested_spacing_m": grid.requested_spacing_m,
        "connectivity_checked": grid.connectivity_checked,
    }
    meta = {**summary, "Ts": prep.Ts, "Nt": prep.Nt, "c": prep.c, "h": prep.h, "offset_m": offset_m,
            "runs": runs, "post": post_params(job)}
    (free_dir / FREE_META).write_text(json.dumps(meta))
    return summary


def run_reciprocal(job: dict, watch, emit: Callable, on_voxelised: Callable, voxel_check: Callable, quiet: Callable,
                   mat_files: dict) -> dict:
    work_dir = Path(job["work_dir"])
    free = job.get("free")
    free_dir = Path(free["dir"]) if free else None
    foa = bool(job["foa"])
    h = float(job["h"])
    offset_m = float(job["foa_offset_cells"]) * h
    sources = np.asarray(job["sources"], np.float64)
    listeners = np.asarray(job["receivers"], np.float64)
    # Directional sources (pffdtd_backend/directional.py) are 7-probe receiver sets; omni ones one probe.
    directivities = list(job.get("source_directivities") or [None] * len(sources))
    probe_sets = [probe_positions(s, bool(spec), offset_m) for s, spec in zip(sources, directivities)]
    rows = probe_row_ranges([bool(spec) for spec in directivities])
    probes = np.vstack(probe_sets)
    channels = ["W", *AXES] if foa else ["W"]
    runs = [(li, ch) for li in range(len(listeners)) for ch in channels]
    meta = {"h": h, "sources": [], "reciprocal": True, "directional_sources": [bool(spec) for spec in directivities]}
    base = grid = None
    energies: list[np.ndarray] = []
    store_runs: list[dict] = []
    signals: dict[int, dict[str, np.ndarray]] = {}
    Ts = c = None

    for k, (li, ch) in enumerate(runs):
        pct0, span = 100.0 * k / len(runs), 100.0 / len(runs)
        label = f"Listener {li + 1}/{len(listeners)}" + (f" ({ch})" if foa else "")
        listener = listeners[li].tolist()
        if base is None:
            emit(pct0 + 1, f"{label}: voxelising the geometry...")
            spec = SimSpec(
                sim_dir=work_dir / "base",
                scene={"mats_hash": job["mats_hash"], "sources": [{"xyz": listener}], "receivers": [{"xyz": p} for p in probes.tolist()]},
                duration=float(job["duration"]), h=h, fcc=False, precision=job["precision"], mat_files=mat_files,
                Tc=float(job["Tc"]), rh=float(job["rh"]), vox_cache_dir=Path(job["voxel_cache_dir"]) if job.get("voxel_cache_dir") else None,
                **job_domain_bounds(job),
            )
            base = voxel_check(prepare, spec)
            on_voxelised(base)
            if free:
                grid = make_grid(job, base, listeners, n_probe=1, n_runs=len(runs))
        else:
            emit(pct0 + 1, f"{label}: preparing (voxelisation reused)...")
        extra = {"source_points": dipole_points(listener, ch, offset_m)} if ch != "W" else {}
        prep = voxel_check(derive, base, work_dir / f"run_{k}", source_xyz=listener,
                           node_receivers=grid.probe_ixyz if grid is not None else None, **extra)
        e0 = pct0 + 0.2 * span

        def on_progress(pct, elapsed, eta, e0=e0, label=label):
            emit(e0 + 0.7 * span * pct / 100.0, f"{label}: GPU solve {pct:.0f}% (ETA {eta:.0f} s)")

        runtime = run_engine(prep.gpu_dir, job["precision"], on_progress=on_progress, should_stop=lambda: watch.dead)
        emit(pct0 + 0.9 * span, f"{label}: post-processing...")
        r_out, Ts = read_receivers(prep.gpu_dir)
        c = prep.c
        # One signal per source: the omni probe, or the composed first-order pattern of a
        # directional source (its 7 probes -> w and u·p channels, u toward the listener).
        per_source = np.empty((sources.shape[0], r_out.shape[1]))
        for si, ((row0, n_rows), spec_i) in enumerate(zip(rows, directivities)):
            block = r_out[row0:row0 + n_rows]
            if spec_i:
                chs = foa_channels(block, Ts, offset_m, c)  # [W, Y, Z, X]
                per_source[si] = compose(chs[0], chs[[3, 1, 2]], spec_i, 1.0 / Ts)
            else:
                per_source[si] = block[0]
        signals.setdefault(li, {})[ch] = per_source
        if grid is not None and free_dir is not None:
            energy = store_run(prep, grid, free_dir, k)
            if ch == "W":
                energies.append(energy)
            store_runs.append({"file": run_file(k), "fixed_index": li, "channel": ch})
        meta["sources"].append({"index": k, "listener_index": li, "channel": ch, "Ts": prep.Ts, "c": prep.c,
                                "grid": list(prep.shape), "boundary_nodes": prep.Nb, "steps": prep.Nt, "gpu_runtime_s": runtime})
        shutil.rmtree(prep.spec.sim_dir, ignore_errors=True)

    emit(99, "Writing impulse responses...")
    post = {**post_params(job), "gain": 1.0}  # the worker applies the reference gain to the pair WAVs
    for si in range(sources.shape[0]):
        irs = []
        for li in range(listeners.shape[0]):
            sig = signals[li]
            axes = {a: sig[a][si] for a in AXES} if foa else None
            irs.append(quiet(to_wav_ir, reciprocal_channels(sig["W"][si], axes, Ts, offset_m, c), Ts, post))
        np.savez(work_dir / f"src_{si}.npz", irs=np.asarray(irs, np.float32), fs=float(job["out_fs"]))
    if grid is not None and free_dir is not None:
        meta["free"] = write_store(free_dir, job, grid, energies, store_runs, base, offset_m)
    emit(100, "Done")
    (work_dir / "meta.json").write_text(json.dumps(meta))
    return meta
