"""PFFDTD job pipeline -- runs inside the compas-pffdtd env.

    <compas-pffdtd python> -I backend/pffdtd_backend/pipeline.py job.json --parent-pid <pid>

Called by services/pffdtd_job.py and services/pffdtd_preview_job.py (compas-toy).

Simulation job (default mode): fit materials (cached), prepare + voxelise ONCE, then per
source run the CUDA engine (sources 2..N are derived from the first source's voxelisation),
post-process the receivers to IRs at out_fs and write <work_dir>/src_<i>.npz (irs [R, C, N]).
With ``plane_z`` set, each IR run also accumulates the band-passed p^2 on a 3D lattice
(every ``spl_volume_stride``-th node; strength-G volume spl_vol_src_<i>.f32 [nz, ny, nx]),
the plane mask at plane_z is written, and the voxelisation is kept for on-demand wave
animations (animation.save_base). Writes <work_dir>/meta.json at the end.
With ``free`` set, every run also records a candidate grid for free positioning; the
reciprocal ("source") mode runs per listener instead (free_runs.py, ir_server.py).

Animation job (``mode: "animation"``): pulse runs derived from a finished simulation's kept
voxelisation, snapshotting one horizontal plane (see animation.run_animation).

Voxel preview job (``mode: "voxel_preview"``): voxelise only and write preview.json +
points.bin (see run_preview).

stdout protocol (one line each, flushed):
    COMPAS_PROGRESS <0-100> <message>
    COMPAS_STAGE <name> [<json>]      (a milestone, value true unless given; "voxelised" = the
                                       job's grid is built, "problems" = grid warnings for the card)
    COMPAS_ERROR <message>            (then exit code 2)
If the parent process disappears (job cancelled / worker killed), the engine is killed
and this process exits.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import h5py  # noqa: E402
import numpy as np  # noqa: E402
import psutil  # noqa: E402

from pffdtd_backend.animation import PLANE_MASK_FILE, plane_mask, run_animation, save_base  # noqa: E402
from pffdtd_backend.engine import EngineError, kill_active, run_engine  # noqa: E402
from pffdtd_backend.fields import band_sos, strength_g  # noqa: E402
from pffdtd_backend.free_ir import run_file  # noqa: E402
from pffdtd_backend.free_runs import make_grid, run_reciprocal, store_run, write_store  # noqa: E402
from pffdtd_backend.materials import material_def_file  # noqa: E402
from pffdtd_backend.outputs import (  # noqa: E402
    PLANE_AIR,
    PLANE_OUTSIDE,
    PLANE_WALL,
    lattice_nodes,
    plane_nodes,
    read_plane_accum,
    read_receivers,
)
from pffdtd_backend.postprocess import foa_channels, probe_positions, to_ir  # noqa: E402
from pffdtd_backend.sim_prepare import SimSpec, derive, job_domain_bounds, prepare, with_extras  # noqa: E402

PARENT_POLL_S = 1.0
# share of each source's progress span: setup/voxelisation, IR solve, post-processing
STAGE_SPLIT = (0.2, 0.7, 0.1)
# lattice nodes whose p^2 is this far below the source's maximum received nothing (outside the room)
OUTSIDE_P2_RATIO = 1e-10


STAGE_VOXELISED = "voxelised"
STAGE_PROBLEMS = "problems"


def _vox_cache_dir(job: dict) -> Path | None:
    cache_dir = job.get("voxel_cache_dir")
    return Path(cache_dir) if cache_dir else None


def emit(pct: float, msg: str) -> None:
    print(f"COMPAS_PROGRESS {pct:.1f} {msg}", flush=True)


def emit_stage(name: str, value=None) -> None:
    print(f"COMPAS_STAGE {name}" + ("" if value is None else f" {json.dumps(value)}"), flush=True)


def run_problems(prep) -> list[dict]:
    """Grid problems found while preparing a run (same shape as the voxel preview's, unlocated)."""
    problems = []
    if prep.air_leak:
        problems.append({
            "id": "run-pffdtd_leak", "severity": "warning", "code": "pffdtd_leak", "positions": [],
            "title": "Sound leaks out of the model",
            "detail": (
                "The air around the source reaches the edge of the simulation grid: the model has a gap "
                f"of at least one grid cell. {prep.air_leak['air_volume_m3']:,.0f} m\u00b3 of air is simulated "
                "and energy escapes through the gaps, so the reverberation will be too short. Close the "
                "holes (Geometry check / Preview voxels show where) and run again."
            ),
        })
    return problems


def emit_voxelised(prep) -> None:
    """The job's grid is built: report its problems, then the milestone."""
    problems = run_problems(prep)
    if problems:
        emit_stage(STAGE_PROBLEMS, problems)
    emit_stage(STAGE_VOXELISED)


class ParentWatch:
    """Flags (and hard-exits) once the parent process is gone."""

    def __init__(self, parent_pid: int | None):
        self.parent_pid = parent_pid
        self.dead = False
        if parent_pid:
            threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            time.sleep(PARENT_POLL_S)
            if not psutil.pid_exists(self.parent_pid):
                self.dead = True
                kill_active()  # frees the GPU now (the exe would otherwise outlive this process)
                os._exit(3)


def _quiet(fn, *args, **kwargs):
    """Upstream setup code prints a lot; keep it out of the progress protocol (to stderr)."""
    with contextlib.redirect_stdout(sys.stderr):
        return fn(*args, **kwargs)


def _voxel_check(fn, *args, **kwargs):
    try:
        return _quiet(fn, *args, **kwargs)
    except AssertionError as exc:
        raise RuntimeError(
            "Voxelisation check failed (a source or receiver may be within one grid cell of a "
            f"surface, or outside the model): {exc or 'assertion'}"
        ) from exc


def _bn_ixyz(prep) -> np.ndarray:
    with h5py.File(prep.setup_dir / "vox_out.h5", "r") as f:
        return f["bn_ixyz"][...]


def run_job(job: dict, watch: ParentWatch) -> dict:
    work_dir = Path(job["work_dir"])
    work_dir.mkdir(parents=True, exist_ok=True)
    foa = bool(job["foa"])
    h = float(job["h"])
    fmax = float(job["fmax"])
    offset_m = float(job["foa_offset_cells"]) * h
    n_src = len(job["sources"])
    plane_z = job.get("plane_z")

    emit(1, "Fitting boundary materials...")
    mat_files = {
        name: str(_quiet(material_def_file, m["coeffs"], m["center_freqs"], job["material_cache_dir"]))
        for name, m in job["materials"].items()
    }
    free = job.get("free")  # free positioning (free_runs.py); the reciprocal mode has its own loop
    # Free source and directional sources (job["reciprocal"]) both run from the listeners.
    if (free and free["mode"] == "source") or job.get("reciprocal"):
        return run_reciprocal(job, watch, emit, emit_voxelised, _voxel_check, _quiet, mat_files)

    receivers = np.asarray(job["receivers"], np.float64)
    probes = np.vstack([probe_positions(r, foa, offset_m) for r in receivers])
    n_probe = probes.shape[0] // receivers.shape[0]
    meta = {"h": h, "sources": []}
    base = plane = lattice = sos = grid = None
    p2_maps: list[np.ndarray] = []
    energies: list[np.ndarray] = []
    store_runs: list[dict] = []

    for si, src in enumerate(job["sources"]):
        pct0 = 100.0 * si / n_src
        span = 100.0 / n_src
        if base is None:
            emit(pct0 + 1, f"Source {si + 1}/{n_src}: building the grid (voxelisation, cut cells)...")
            spec = SimSpec(
                sim_dir=work_dir / f"src_{si}",
                scene={"mats_hash": job["mats_hash"], "sources": [{"xyz": src}], "receivers": [{"xyz": p} for p in probes.tolist()]},
                duration=float(job["duration"]),
                h=h,
                fcc=False,
                precision=job["precision"],
                mat_files=mat_files,
                Tc=float(job["Tc"]),
                rh=float(job["rh"]),
                vox_cache_dir=_vox_cache_dir(job),
                **job_domain_bounds(job),
            )
            prep = _voxel_check(prepare, spec)
            emit_voxelised(prep)  # the only voxelisation of the job: sources 2..N derive from it
            if plane_z is not None:
                bn = _bn_ixyz(prep)
                plane = plane_nodes(prep.xv, prep.yv, prep.zv, bn, float(plane_z), int(job["field_max_px"]))
                lattice = lattice_nodes(prep.xv, prep.yv, prep.zv, bn, int(job["spl_volume_stride"]), int(job["spl_volume_max_nodes"]))
                del bn
                sos = band_sos(1.0 / prep.Ts, fmax, float(job["lowcut_hz"]), int(job["lowcut_order"]), int(job["lowpass_order"]))
                # the IR runs accumulate on the lattice (animation runs snapshot a plane later)
                prep = with_extras(prep, plane_ixyz=lattice.ixyz, acc_sos=sos)
            base = prep
            if free:  # every run records the candidate grid, so the first one is derived too
                grid = make_grid(job, base, job["sources"], n_probe=n_probe, n_runs=n_src)
                prep = _voxel_check(derive, base, work_dir / f"src_{si}_free", source_xyz=src, node_receivers=grid.probe_ixyz)
        else:
            emit(pct0 + 1, f"Source {si + 1}/{n_src}: preparing (voxelisation reused)...")
            prep = _voxel_check(derive, base, work_dir / f"src_{si}", source_xyz=src,
                                node_receivers=None if grid is None else grid.probe_ixyz)

        e0 = pct0 + span * STAGE_SPLIT[0]

        def on_progress(pct, elapsed, eta, e0=e0, si=si):
            emit(e0 + span * STAGE_SPLIT[1] * pct / 100.0, f"Source {si + 1}/{n_src}: GPU solve {pct:.0f}% (ETA {eta:.0f} s)")

        runtime = run_engine(prep.gpu_dir, job["precision"], on_progress=on_progress, should_stop=lambda: watch.dead)
        src_meta = {"index": si, "Ts": prep.Ts, "c": prep.c, "grid": list(prep.shape), "boundary_nodes": prep.Nb,
                    "steps": prep.Nt, "gpu_runtime_s": runtime}

        if lattice is not None:
            p2_maps.append(read_plane_accum(prep).reshape(lattice.shape))
            src_meta["spl_steps"] = prep.Nt
        if grid is not None:
            energies.append(store_run(prep, grid, Path(free["dir"]), si))
            store_runs.append({"file": run_file(si), "fixed_index": si, "channel": "P"})

        emit(pct0 + span * sum(STAGE_SPLIT[:2]), f"Source {si + 1}/{n_src}: post-processing...")
        r_out, Ts = read_receivers(prep.gpu_dir)
        irs = []
        for ri in range(receivers.shape[0]):
            sig = r_out[ri * n_probe : (ri + 1) * n_probe]
            if foa:
                sig = foa_channels(sig, Ts, offset_m, prep.c)
            irs.append(
                _quiet(
                    to_ir,
                    sig,
                    Ts,
                    fmax=fmax,
                    out_fs=float(job["out_fs"]),
                    duration=float(job["duration"]),
                    lowcut_hz=float(job["lowcut_hz"]),
                    lowcut_order=int(job["lowcut_order"]),
                    lowpass_order=int(job["lowpass_order"]),
                    air_absorption=bool(job["air_absorption"]),
                    Tc=float(job["Tc"]),
                    rh=float(job["rh"]),
                )
            )
        np.savez(work_dir / f"src_{si}.npz", irs=np.asarray(irs, np.float32), fs=float(job["out_fs"]))
        if prep is not base:
            shutil.rmtree(prep.gpu_dir, ignore_errors=True)  # derived runs: the setup links stay
        meta["sources"].append(src_meta)

    if lattice is not None:
        meta["volume"], outside = _write_volume_outputs(work_dir, lattice, p2_maps, sos, float(job["spl_reference_m"]), base.Nt, meta)
        meta["plane"] = _write_plane_mask(work_dir, plane, lattice, outside)
        save_base(work_dir / job["anim_base_dir"], base, lattice, outside)
    if grid is not None:
        meta["free"] = write_store(Path(free["dir"]), job, grid, energies, store_runs, base, offset_m)
    emit(100, "Done")
    (work_dir / "meta.json").write_text(json.dumps(meta))
    return meta


def _write_volume_outputs(work_dir: Path, lattice, p2_maps, sos, ref_m: float, nt: int, meta: dict):
    """Volume mask (air / wall / outside for every source) + one strength-G volume per source.

    Returns (volume dict, outside [nz, ny, nx] bool)."""
    outside = np.ones(lattice.shape, bool)
    for p2 in p2_maps:
        outside &= p2 <= OUTSIDE_P2_RATIO * max(float(p2.max()), 0.0)
    mask = np.full(lattice.shape, PLANE_AIR, np.uint8)
    mask[outside] = PLANE_OUTSIDE
    mask[lattice.walls] = PLANE_WALL
    mask.tofile(work_dir / "volume_mask.u8")
    for si, p2 in enumerate(p2_maps):
        g = strength_g(p2, sos, ref_m, nt)
        g[outside] = np.nan
        g.astype(np.float32).tofile(work_dir / f"spl_vol_src_{si}.f32")
        inside = g[np.isfinite(g) & (mask == PLANE_AIR)]
        meta["sources"][si]["spl"] = {
            "volume_file": f"spl_vol_src_{si}.f32",
            "min_db": float(inside.min()) if inside.size else None,
            "max_db": float(inside.max()) if inside.size else None,
        }
    return {**lattice.as_dict(), "mask_file": "volume_mask.u8", "reference_m": ref_m}, outside


def _write_plane_mask(work_dir: Path, plane, lattice, outside: np.ndarray) -> dict:
    """Mask of the default plane (listener height; animations bring their own)."""
    plane_mask(plane, lattice, outside).tofile(work_dir / PLANE_MASK_FILE)
    return {**plane.as_dict(), "mask_file": PLANE_MASK_FILE}


# â”€â”€â”€ voxel preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _node_positions(xv, yv, zv, ixyz):
    Ny, Nz = yv.size, zv.size
    return np.c_[xv[ixyz // (Ny * Nz)], yv[(ixyz // Nz) % Ny], zv[ixyz % Nz]]


def _nearest_node(xv, yv, zv, p) -> tuple[int, int, int] | None:
    idx = []
    for v, c in zip((xv, yv, zv), p):
        i = int(round((c - v[0]) / (v[1] - v[0])))
        if not 0 <= i < v.size:
            return None
        idx.append(i)
    return tuple(idx)


def _interp_nodes(xv, yv, zv, p) -> np.ndarray | None:
    """The 8 trilinear-interpolation nodes PFFDTD uses for a source/receiver (flat indices)."""
    Ny, Nz = yv.size, zv.size
    lo = []
    for v, c in zip((xv, yv, zv), p):
        i = int(np.floor((c - v[0]) / (v[1] - v[0])))
        if not 0 <= i < v.size - 1:
            return None
        lo.append(i)
    ix, iy, iz = lo
    return np.array([(ix + a) * Ny * Nz + (iy + b) * Nz + (iz + c) for a in (0, 1) for b in (0, 1) for c in (0, 1)], np.int64)


def run_preview(job: dict) -> dict:
    """Voxelise and check the grid; writes preview.json and points.bin into work_dir.

    points.bin: float32 [N, 3] boundary-node positions (subsampled), then uint8 [N] material
    index (255 = rigid). Problems carry positions (and a radius for clearance spheres).
    """
    from scipy import ndimage
    from scipy.spatial import cKDTree

    from pffdtd_backend.sim_prepare import voxelise_only

    work_dir = Path(job["work_dir"])
    work_dir.mkdir(parents=True, exist_ok=True)
    sources = [list(map(float, s)) for s in job["sources"]]
    receivers = [list(map(float, r)) for r in job["receivers"]]
    labels = job.get("material_labels", {})
    clearance = float(job["clearance_cells"])
    problems: list[dict] = []

    def problem(severity, code, title, detail, positions, **extra):
        problems.append({"id": f"{code}-{len(problems)}", "severity": severity, "code": code, "title": title,
                         "detail": detail, "positions": [list(map(float, p)) for p in positions], **extra})

    emit(5, "Voxelising the geometry (and the solver's cut cells)...")
    spec = SimSpec(
        sim_dir=work_dir,
        scene={"mats_hash": job["mats_hash"], "sources": [{"xyz": s} for s in sources], "receivers": [{"xyz": r} for r in receivers]},
        duration=0.01, h=float(job["h"]), fcc=False, precision="double", vox_cache_dir=_vox_cache_dir(job),
    )
    # the first source's cut cells are cached too, so the run that follows skips them
    vs = _quiet(voxelise_only, spec, warm_seed_xyz=sources[0] if sources else None)
    h = vs.h
    xv, yv, zv = vs.xv, vs.yv, vs.zv
    Nx, Ny, Nz = vs.shape
    bn = vs.bn_ixyz

    emit(55, "Checking the grid...")
    counts = np.bincount(vs.mat_bn + 1, minlength=len(vs.mat_names) + 1)
    materials = [{"index": k, "name": n, "label": labels.get(n, n), "count": int(counts[k + 1])} for k, n in enumerate(vs.mat_names)]
    for m in materials:
        if m["count"] == 0:
            problem("warning", "pffdtd_material_lost", f"{m['label']}: no grid nodes",
                    f"Every surface with this material is thinner or smaller than the grid spacing "
                    f"({h * 100:.1f} cm), so it does not exist in the simulation. Raise fmax or PPW.", [])
    if vs.asymmetric_links:
        problem("error", "pffdtd_voxel_asymmetric", "Voxeliser produced an unstable boundary",
                f"{vs.asymmetric_links} asymmetric grid links. Simplify overlapping or intersecting surfaces.", [])

    pos = _node_positions(xv, yv, zv, bn)
    src_ids = job.get("source_ids") or [str(i + 1) for i in range(len(sources))]
    rcv_ids = job.get("receiver_ids") or [str(i + 1) for i in range(len(receivers))]
    seeds = [("source", src_ids[i], p) for i, p in enumerate(sources)] + [("receiver", rcv_ids[i], p) for i, p in enumerate(receivers)]
    tree = cKDTree(pos) if bn.size else None
    bn_set = np.sort(bn)
    for kind, sid, p in seeds:
        name = f"{'Source' if kind == 'source' else 'Listener'} '{sid}'"
        seed = {"kind": kind, "id": sid}
        nodes = _interp_nodes(xv, yv, zv, p)
        if nodes is None:
            problem("error", "pffdtd_seed_outside_grid", f"{name} is outside the grid", "Move it inside the model.", [p], seed=seed)
            continue
        hit = np.searchsorted(bn_set, nodes)
        if np.any((hit < bn_set.size) & (bn_set[np.minimum(hit, bn_set.size - 1)] == nodes)):
            problem("error", "pffdtd_seed_on_boundary", f"{name} sits on a boundary node",
                    "Its grid cell touches a surface; the engine refuses this. Move it away from the surface.",
                    [p], radius_m=clearance * h, seed=seed)
            continue
        if tree is not None:
            d, _ = tree.query(p)
            if d < clearance * h:
                problem("error", "pffdtd_seed_clearance", f"{name} is {d / h:.1f} cells from a surface",
                        f"Needs {clearance:g} cells ({clearance * h * 100:.0f} cm) of clearance for the stencil "
                        "and the FOA probes. Move it or raise the resolution.", [p], radius_m=clearance * h, seed=seed)

    leak_check = {"done": False, "leak": False}
    if Nx * Ny * Nz > int(job["preview_max_label_nodes"]):
        leak_check["note"] = f"Skipped: the grid has {Nx * Ny * Nz / 1e6:.0f} M nodes (limit {int(job['preview_max_label_nodes']) / 1e6:.0f} M)."
    else:
        emit(75, "Checking for leaks and unreachable listeners...")
        air = np.ones(Nx * Ny * Nz, bool)
        air[bn] = False
        lab, _ = ndimage.label(air.reshape(Nx, Ny, Nz), structure=ndimage.generate_binary_structure(3, 1))
        del air
        pts = np.concatenate([np.asarray(m["pts"], np.float64) for m in job["mats_hash"].values()])
        bmin, bmax = pts.min(axis=0), pts.max(axis=0)
        inside = [(v >= lo - 0.5 * h) & (v <= hi + 0.5 * h) for v, lo, hi in zip((xv, yv, zv), bmin, bmax)]
        near = [(v >= lo - 1.5 * h) & (v <= hi + 1.5 * h) for v, lo, hi in zip((xv, yv, zv), bmin, bmax)]
        leak_check["done"] = True
        for si, s in enumerate(sources):
            node = _nearest_node(xv, yv, zv, s)
            if node is None or lab[node] == 0:
                continue
            comp = lab == lab[node]
            out = comp & ~(inside[0][:, None, None] & inside[1][None, :, None] & inside[2][None, None, :])
            if out.any():
                leak_check["leak"] = True
                edge = out & near[0][:, None, None] & near[1][None, :, None] & near[2][None, None, :]
                ix, iy, iz = np.nonzero(edge if edge.any() else out)
                sel = np.random.default_rng(0).permutation(ix.size)[: int(job["max_leak_points"])]
                problem("warning", "pffdtd_leak", f"Sound leaks out of the model from source '{src_ids[si]}'",
                        "The air around this source connects to the outside of the model (a gap of at least "
                        "one grid cell). Energy escapes, so the reverberation will be too short. Red points "
                        "mark where it leaves the bounding box.", np.c_[xv[ix[sel]], yv[iy[sel]], zv[iz[sel]]])
            for ri, r in enumerate(receivers):
                rnode = _nearest_node(xv, yv, zv, r)
                if rnode is not None and lab[rnode] != 0 and lab[rnode] != lab[node]:
                    problem("warning", "pffdtd_receiver_unreachable",
                            f"Listener '{rcv_ids[ri]}' cannot hear source '{src_ids[si]}'",
                            "They are in air volumes the grid separates (closed surfaces in between). "
                            "Its impulse response will be silent.", [r], seed={"kind": "receiver", "id": rcv_ids[ri]})
        del lab

    emit(92, "Writing the preview...")
    sel = np.arange(bn.size)
    max_points = int(job["preview_max_points"])
    if bn.size > max_points:
        sel = np.sort(np.random.default_rng(0).choice(bn.size, max_points, replace=False))
    mat_idx = np.where(vs.mat_bn[sel] < 0, 255, vs.mat_bn[sel]).astype(np.uint8)
    with open(work_dir / "points.bin", "wb") as f:
        f.write(pos[sel].astype(np.float32).tobytes())
        f.write(mat_idx.tobytes())
    preview = {
        "grid": {"h": h, "shape": [Nx, Ny, Nz], "nodes": Nx * Ny * Nz, "boundary_nodes": int(bn.size)},
        "n_points": int(sel.size),
        "materials": materials,
        "rigid_count": int(counts[0]),
        "problems": problems,
        "leak_check": leak_check,
    }
    (work_dir / "preview.json").write_text(json.dumps(preview))
    emit(100, "Done")
    return preview


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job_json")
    ap.add_argument("--parent-pid", type=int, default=None)
    args = ap.parse_args()
    # progress lines must not be mangled by a legacy console code page
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    watch = ParentWatch(args.parent_pid)
    try:
        job = json.loads(Path(args.job_json).read_text())
        if job.get("mode") == "voxel_preview":
            run_preview(job)
        elif job.get("mode") == "animation":
            run_animation(job, watch, emit, _voxel_check, _bn_ixyz)
        else:
            run_job(job, watch)
    except EngineError as exc:
        print(f"COMPAS_ERROR {str(exc).splitlines()[0] if str(exc) else 'engine failed'}", flush=True)
        traceback.print_exc()
        return 2
    except Exception as exc:
        print(f"COMPAS_ERROR {type(exc).__name__}: {exc}", flush=True)
        traceback.print_exc()
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
