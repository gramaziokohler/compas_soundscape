"""Pre-simulation geometry check of the BRAS scenes: one figure per scene and fmax stage.

From backend/, with the compas-soundscape (or compas-toy) python:

    python tests/benchmarks/bras/bras_geometry_check.py                      # every scene, every stage
    python tests/benchmarks/bras/bras_geometry_check.py --scenes RS5 RS7 --stages 500
    python tests/benchmarks/bras/bras_geometry_check.py --no-voxels           # geometric acoustics only

Each figure (``<BRAS_OUTPUT_ROOT>/_geometry_check/<scene>_f<fmax>.png``) shows, from two viewpoints:

* PFFDTD: the boundary nodes of the solver's own voxelisation (``pffdtd_backend.sim_prepare.voxelise_only``
  in the compas-pffdtd env) on the benchmark's grid and padded domain, coloured by material; the floor of
  a hemi-anechoic chamber is drawn as a plane. The voxelisation goes into the solver's voxel cache, so the
  run that follows reuses it.
* Geometric acoustics: the walls the engine builds (the app's mesh preparation of the scene inside its
  absorbing shell), coloured by material; compas_acoustics' obstacles, objects left in the room boundary
  (red, hatched: they do not diffract), obstacles that give no diffracting edge (red outline), and the
  diffracting edges (magenta).
* A plan of the whole domain (PFFDTD domain, absorbing shell, objects, pairs: shadowed ones dashed red),
  and the numbers: grid, voxels per material, seed clearance, closure, edges, warnings, problems.

``index.md`` in the same folder lists every figure and its problems. The voxelisation also runs on its own
with ``--voxelise-job <job.json>`` (that is how the compas-pffdtd env is called).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

import numpy as np

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
_BACKEND = _TESTS.parent
for _p in (str(_BACKEND), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

CHECK_DIR = "_geometry_check"
VOXEL_DIR = "_voxels"
INDEX = "index.md"
MAX_POINTS = 150_000          # boundary nodes drawn per panel (uniformly subsampled beyond)
VIEWS = ((24.0, -58.0), (18.0, 122.0))   # (elevation, azimuth) of the two perspective views
BOUNDARY_OBJECT_COLOR = "#e34948"
SHADOW_COLOR = "#e34948"
LOS_COLOR = "#9a9890"
# transparent faces of a hatch overlay: "none" gives Poly3DCollection no face colours, and its
# depth sort (mplot3d art3d.do_3d_projection) then zips nothing and fails
CLEAR = (0.0, 0.0, 0.0, 0.0)


# ── voxelisation (runs in the compas-pffdtd env) ────────────────────────────

def _voxelise_job(job_path: str) -> int:
    """compas-pffdtd side: ``voxelise_only`` on the job's grid and domain; writes ``job["out"]`` (npz)."""
    from pffdtd_backend.sim_prepare import SimSpec, voxelise_only

    job = json.loads(Path(job_path).read_text())
    work = Path(job["work_dir"])
    spec = SimSpec(
        sim_dir=work, duration=0.01, h=float(job["h"]), fcc=False, precision="double",
        scene={"mats_hash": job["mats_hash"], "sources": [{"xyz": s} for s in job["sources"]],
               "receivers": [{"xyz": r} for r in job["receivers"]]},
        vox_cache_dir=Path(job["voxel_cache_dir"]), bmin=np.asarray(job["bmin"]), bmax=np.asarray(job["bmax"]),
    )
    vs = voxelise_only(spec, warm_seed_xyz=job["sources"][0] if job["sources"] else None)
    np.savez_compressed(job["out"], bn_ixyz=vs.bn_ixyz, mat_bn=vs.mat_bn, mat_names=np.array(vs.mat_names),
                        xv=vs.xv, yv=vs.yv, zv=vs.zv, h=vs.h, asymmetric_links=vs.asymmetric_links)
    return 0


def pffdtd_python() -> str:
    """The compas-pffdtd interpreter: PFFDTD_PYTHON (config), else the env beside this one."""
    from config.constants import PFFDTD_ENV_NAME, PFFDTD_PYTHON

    if PFFDTD_PYTHON and Path(PFFDTD_PYTHON).exists():
        return PFFDTD_PYTHON
    exe = "python.exe" if os.name == "nt" else "bin/python"
    guess = Path(sys.executable).resolve().parent.parent / PFFDTD_ENV_NAME / exe
    if not guess.exists():
        raise RuntimeError(f"compas-pffdtd python not found: set PFFDTD_PYTHON (tried {guess})")
    return str(guess)


def voxelise(rp, cache_root: Path) -> dict:
    """The staircase boundary nodes PFFDTD builds for the run ``rp`` (cached per mesh + grid + domain).

    Returns ``positions`` (N, 3), ``keys`` (scene material key per node, "rigid" for -1), the grid, and the
    voxeliser's asymmetric link count."""
    from config.constants import PFFDTD_VOXEL_CACHE_DIR
    from services.pffdtd_job import prepare_pffdtd_mesh, unique_seeds
    from services.pffdtd_scene_export import build_scene

    from benchmarks.bras.bras_setup_plots import _face_names

    mesh, _ = prepare_pffdtd_mesh(rp.scene_geo, rp.pairs_data, None)
    mats_hash, _ = build_scene(mesh)
    names = {}
    for fi, name in _face_names(mesh).items():
        names.setdefault(name, fi)
    by_json = {json.dumps(v, sort_keys=True, default=str): k for k, v in rp.coeffs.items()}
    name_key = {n: by_json.get(json.dumps(mesh.face_material[fi], sort_keys=True, default=str), n) for n, fi in names.items()}
    sources, receivers = unique_seeds(rp.pairs_data)
    h = float(rp.domain.h)
    job = {"mats_hash": mats_hash, "h": h, "bmin": np.asarray(rp.bounds[0]).tolist(), "bmax": np.asarray(rp.bounds[1]).tolist(),
           "sources": list(sources.values()), "receivers": list(receivers.values()), "voxel_cache_dir": PFFDTD_VOXEL_CACHE_DIR}
    digest = hashlib.sha1(json.dumps(job, sort_keys=True, default=str).encode()).hexdigest()[:16]
    out = cache_root / f"vox_{digest}.npz"
    if not out.exists():
        cache_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="bras_vox_") as tmp:
            job.update(work_dir=str(Path(tmp) / "sim"), out=str(out))
            job_path = Path(tmp) / "job.json"
            job_path.write_text(json.dumps(job))
            t0 = time.time()
            exe = pffdtd_python()
            prefix = Path(exe).parent   # its DLL folders first (numpy/BLAS, hdf5), as services.pffdtd_job._pipeline_env
            env = dict(os.environ, PYTHONUTF8="1")
            env["PATH"] = os.pathsep.join([str(prefix), str(prefix / "Library" / "bin"), str(prefix / "Scripts"), env.get("PATH", "")])
            env.pop("PYTHONPATH", None)
            proc = subprocess.run([exe, "-I", str(Path(__file__).resolve()), "--voxelise-job", str(job_path)],
                                  capture_output=True, text=True, cwd=str(_BACKEND), env=env, encoding="utf-8", errors="replace")
            if proc.returncode != 0 or not out.exists():
                tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-15:])
                raise RuntimeError(f"voxelisation failed (exit {proc.returncode}):\n{tail}")
            print(f"[check] voxelised in {time.time() - t0:.0f} s", flush=True)
    with np.load(out) as z:
        v = {k: z[k] for k in z.files}
    shape = (v["xv"].size, v["yv"].size, v["zv"].size)
    ix, iy, iz = np.unravel_index(np.asarray(v["bn_ixyz"], np.int64), shape)
    pos = np.stack([v["xv"][ix], v["yv"][iy], v["zv"][iz]], axis=1)
    mat_names = [str(n) for n in v["mat_names"]]
    mat = np.asarray(v["mat_bn"], np.int64)
    lookup = np.array([name_key.get(n, n) for n in mat_names] + ["rigid"], dtype=object)
    keys = lookup[np.where(mat < 0, len(mat_names), mat)]
    lost = [name_key.get(n, n) for k, n in enumerate(mat_names) if not np.any(mat == k)]
    return {"positions": pos, "keys": keys, "h": float(v["h"]), "shape": shape,
            "asymmetric_links": int(v["asymmetric_links"]), "lost": lost, "file": out.name}


# ── data for one stage ──────────────────────────────────────────────────────

def _seed_clearance(vox: dict, rp) -> list[tuple[str, float]]:
    """(seed id, distance to the nearest boundary node in cells) of every source and receiver."""
    from scipy.spatial import cKDTree

    from benchmarks.bras.bras_setup_plots import _seeds

    if not len(vox["positions"]):
        return []
    tree = cKDTree(vox["positions"])
    src, rcv = _seeds(rp)
    return [(sid, float(tree.query(p)[0]) / vox["h"]) for sid, p in {**src, **rcv}.items()]


def _wall_key(value, by_json: dict) -> str:
    return by_json.get(json.dumps(value, sort_keys=True, default=str), "?")


def ga_walls(ga, rp, shell_key: str) -> list[dict]:
    """The engine's walls: corners, material key, two-sided, obstacle, component."""
    mesh = ga.mesh
    by_json = {json.dumps(v, sort_keys=True, default=str): k for k, v in rp.coeffs.items()}
    shell_rng = rp.ga_geo["object_face_ranges"].get(shell_key) if rp.ga_geo else None
    if shell_rng is not None:
        shell_value = rp.ga_geo["face_materials"][shell_rng[0]]
        by_json[json.dumps(shell_value, sort_keys=True, default=str)] = shell_key
    out = []
    for w in mesh.walls:
        f0 = int(w.faces[0])
        out.append({"corners": np.asarray(w.corners, np.float64), "key": _wall_key(mesh.face_material[f0], by_json),
                    "two_sided": bool(mesh.two_sided[f0]), "obstacle": bool(ga.obstacle[f0]),
                    "component": int(np.asarray(mesh.component)[f0]), "faces": np.asarray(w.faces)})
    return out


def _components_without_edges(walls: list, edges: list, ground_key) -> set:
    """Obstacle components that no diffracting edge touches."""
    comps = {}
    for w in walls:
        if w["obstacle"]:
            lo, hi = comps.get(w["component"], (np.full(3, np.inf), np.full(3, -np.inf)))
            comps[w["component"]] = (np.minimum(lo, w["corners"].min(0)), np.maximum(hi, w["corners"].max(0)))
    silent = set()
    for c, (lo, hi) in comps.items():
        hit = any(np.all(np.asarray(a) >= lo - 1e-3) and np.all(np.asarray(a) <= hi + 1e-3)
                  and np.all(np.asarray(b) >= lo - 1e-3) and np.all(np.asarray(b) <= hi + 1e-3) for a, b, _ in edges)
        if not hit:
            silent.add(c)
    return silent


# ── figure ──────────────────────────────────────────────────────────────────

def _alpha_at(coeffs: dict, f: float) -> float:
    fr, a = np.asarray(coeffs.get("center_freqs") or [], float), np.asarray(coeffs.get("coeffs") or [], float)
    if not len(a):
        return float("nan")
    if len(fr) != len(a):
        return float(a[0])
    return float(np.interp(np.log(f), np.log(fr), a))


def _voxel_panel(ax, vox, colors, data, lo, hi, src, rcv, view, title_extra: str) -> None:
    import matplotlib.pyplot as plt  # noqa: F401
    from benchmarks.bras.bras_setup_plots import RIGID_COLOR, _floor_first, _floor_tris, _seeds_3d, _set_3d

    scene = data.scene
    ground = scene.ground
    floor = _floor_tris(scene, lo, hi) if ground is not None else []
    _floor_first(ax, floor, colors.get(ground.material) if floor else None)
    n_view = 0
    n_floor = 0
    if vox is not None and len(vox["positions"]):
        pos, keys = vox["positions"], vox["keys"]
        inside = np.all((pos >= lo) & (pos <= hi), axis=1)
        is_floor = np.zeros(len(pos), bool)
        if ground is not None:
            # the floor's nodes and the rigid ones on its back side (hit from below): drawn as the plane
            is_floor = np.isin(keys, [ground.material, "rigid"]) & (np.abs(pos[:, 2] - ground.z) < 1.5 * vox["h"])
        n_floor = int(np.count_nonzero(is_floor))
        sel = np.flatnonzero(inside & ~is_floor)
        n_view = len(sel)
        if len(sel) > MAX_POINTS:
            sel = np.sort(np.random.default_rng(0).choice(sel, MAX_POINTS, replace=False))
        c = [colors.get(k, RIGID_COLOR) for k in keys[sel]]
        size = float(np.clip(6e4 / max(len(sel), 1), 0.4, 6.0))
        ax.scatter(pos[sel, 0], pos[sel, 1], pos[sel, 2], s=size, c=c, marker="s", linewidths=0, depthshade=True, zorder=1)
    _seeds_3d(ax, src, rcv, data)
    title = f"PFFDTD boundary nodes{title_extra}: {n_view:,} in view" + (f" (+{n_floor:,} floor nodes: the plane)" if n_floor else "")
    if vox is None:
        title = "PFFDTD voxels: not computed"
    _set_3d(ax, lo, hi, title)
    ax.view_init(*view)


def _ga_panel(ax, walls, edges, silent, colors, data, lo, hi, src, rcv, view, shell_key, title) -> None:
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    from benchmarks.bras.bras_plots import STYLE
    from benchmarks.bras.bras_setup_plots import FLOOR_COLOR, _clip_polygon, _edges_3d, _floor_first, _is_floor, _seeds_3d, _set_3d

    ground = data.scene.ground
    gz = ground.z if ground is not None else None
    floor, floor_fc, groups = [], [], {"obstacle": ([], [], []), "boundary": ([], [], []), "silent": ([], [], [])}
    for w in walls:
        if w["key"] == shell_key:
            continue
        p = _clip_polygon(w["corners"], lo, hi)
        if len(p) < 3:
            continue
        if _is_floor(p, gz) and not w["obstacle"]:
            floor.append(p)
            floor_fc.append(colors.get(w["key"], FLOOR_COLOR))
            continue
        role = "boundary" if not w["obstacle"] else ("silent" if w["component"] in silent else "obstacle")
        g = groups[role]
        g[0].append(p)
        g[1].append(colors.get(w["key"], "#888888"))
        g[2].append(w["two_sided"])
    _floor_first(ax, floor, floor_fc or None)
    style = {"obstacle": (STYLE["ink"], 0.4, None), "silent": (BOUNDARY_OBJECT_COLOR, 1.2, None),
             "boundary": (BOUNDARY_OBJECT_COLOR, 1.2, "xxx")}
    for role, (polys, fc, two) in groups.items():
        if not polys:
            continue
        ec, lw, hatch = style[role]
        ax.add_collection3d(Poly3DCollection(polys, facecolors=fc, edgecolors=ec, linewidths=lw, alpha=0.6, zorder=1))
        if hatch:
            ax.add_collection3d(Poly3DCollection(polys, facecolors=CLEAR, edgecolors=ec, linewidths=0.3, hatch=hatch, zorder=2))
        hatched = [p for p, t in zip(polys, two) if t]
        if hatched:
            ax.add_collection3d(Poly3DCollection(hatched, facecolors=CLEAR, edgecolors=STYLE["ink"], linewidths=0.3,
                                                 hatch="////", zorder=2))
    _edges_3d(ax, edges, lo, hi)
    _seeds_3d(ax, src, rcv, data)
    _set_3d(ax, lo, hi, title)
    ax.view_init(*view)


def _plan_panel(ax, data, rp, walls, edges, colors, src, rcv, shell_key) -> None:
    from matplotlib.collections import LineCollection, PolyCollection
    from matplotlib.patches import Rectangle

    from benchmarks.bras.bras_plots import STYLE, _style_axes
    from benchmarks.bras.bras_setup_plots import EDGE_COLOR, RECEIVER_COLOR, SOURCE_COLOR

    _style_axes(ax)
    dlo, dhi = (np.asarray(b, float) for b in rp.bounds)
    shell = [w["corners"] for w in walls if w["key"] == shell_key]
    if data.scene.ground is not None:
        ax.add_patch(Rectangle(dlo[:2], *(dhi - dlo)[:2], facecolor=colors.get(data.scene.ground.material), alpha=0.35,
                               edgecolor="none", zorder=0))
    ax.add_patch(Rectangle(dlo[:2], *(dhi - dlo)[:2], fill=False, ls="--", lw=1.2, edgecolor=STYLE["ink"], zorder=3,
                           label="PFFDTD domain"))
    if shell:
        pts = np.vstack(shell)
        slo, shi = pts.min(0), pts.max(0)
        ax.add_patch(Rectangle(slo[:2], *(shi - slo)[:2], fill=False, ls=":", lw=1.2, edgecolor=STYLE["ink2"], zorder=3,
                               label="absorbing shell (GA)"))
    mesh = data.mesh
    if not mesh.empty:
        tris = mesh.vertices[mesh.faces][:, :, :2]
        ax.add_collection(PolyCollection(tris, facecolors=[colors[m] for m in mesh.materials], edgecolors="none", zorder=2))
    lines, styles = [], []
    for p in rp.sim_pairs or rp.pairs:
        los = rp.geoms[p.key].line_of_sight
        lines.append([np.asarray(p.source_position)[:2], np.asarray(p.receiver_position)[:2]])
        styles.append(los)
    if lines:
        ax.add_collection(LineCollection([l for l, s in zip(lines, styles) if s], colors=LOS_COLOR, lw=0.6, zorder=1))
        ax.add_collection(LineCollection([l for l, s in zip(lines, styles) if not s], colors=SHADOW_COLOR, lw=0.9,
                                         linestyles="--", zorder=1))
    scene_edges = [(a, b) for a, b, on_shell in edges if not on_shell]
    if scene_edges:
        ax.add_collection(LineCollection([[np.asarray(a)[:2], np.asarray(b)[:2]] for a, b in scene_edges],
                                         colors=EDGE_COLOR, lw=1.6, zorder=4))
    for sid, p in src.items():
        ax.plot(*p[:2], "^", color=SOURCE_COLOR, ms=6, zorder=5)
        ax.annotate(sid, p[:2], fontsize=6, color=SOURCE_COLOR, xytext=(3, 3), textcoords="offset points")
    for rid, p in rcv.items():
        ax.plot(*p[:2], "o", color=RECEIVER_COLOR, ms=4, zorder=5)
        ax.annotate(rid, p[:2], fontsize=6, color=RECEIVER_COLOR, xytext=(3, -8), textcoords="offset points")
    pts = np.vstack(shell) if shell else np.vstack([dlo, dhi])
    pad = 0.3
    ax.set_xlim(pts[:, 0].min() - pad, pts[:, 0].max() + pad)
    ax.set_ylim(pts[:, 1].min() - pad, pts[:, 1].max() + pad)
    ax.set_aspect("equal")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.set_title("Plan: PFFDTD domain (dashed), absorbing shell (dotted), pairs (shadowed: red dashed), diffracting edges",
                 fontsize=9, loc="left")


def _text_panel(ax, lines: list[str]) -> None:
    from benchmarks.bras.bras_plots import STYLE

    ax.axis("off")
    ax.text(0.0, 1.0, "\n".join(lines), va="top", ha="left", fontsize=7.4, family="monospace", color=STYLE["ink"],
            transform=ax.transAxes)


def check_stage(data, opts, out_dir: Path, voxels: bool = True) -> dict:
    """One figure for one scene + stage; returns its summary row (problems included)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch

    from benchmarks.bras import bras_constants as K
    from benchmarks.bras.bras_benchmark import plan_run
    from benchmarks.bras.bras_domain import describe_padding
    from benchmarks.bras.bras_plots import STYLE
    from benchmarks.bras.bras_pra import _hash as _ga_hash, ga_scene
    from benchmarks.bras.bras_setup_plots import (EDGE_COLOR, RECEIVER_COLOR, RIGID_COLOR, SOURCE_COLOR, _material_colors,
                                                  _seeds, _view_box, _wrap)
    from config.constants import PFFDTD_SEED_CLEARANCE_CELLS

    scene, mesh = data.scene, data.mesh
    rp = plan_run(data, opts)
    d = rp.domain
    ground_key = scene.ground.material if scene.ground is not None else None
    colors = _material_colors(list(scene.materials), ground_key)
    src, rcv = _seeds(rp)
    lo, hi = _view_box(mesh, list(src.values()) + list(rcv.values()), scene.ground.z if scene.ground is not None else None)
    problems, warnings_ = [], []

    # PFFDTD voxels
    vox, vox_error = None, None
    if voxels:
        try:
            vox = voxelise(rp, out_dir / VOXEL_DIR)
        except Exception as exc:
            vox_error = str(exc).splitlines()[0][:160]
            traceback.print_exc()
            problems.append(f"voxelisation failed: {vox_error}")
    clearance = _seed_clearance(vox, rp) if vox is not None else []
    if vox is not None:
        for k in vox["lost"]:
            problems.append(f"PFFDTD: material {k} has no grid node (thinner than h)")
        if vox["asymmetric_links"]:
            problems.append(f"PFFDTD: {vox['asymmetric_links']} asymmetric voxel links (unstable boundary)")
        for sid, cells in clearance:
            if cells < PFFDTD_SEED_CLEARANCE_CELLS:
                problems.append(f"PFFDTD: {sid} is {cells:.1f} cells from a boundary node (< {PFFDTD_SEED_CLEARANCE_CELLS:g})")
    if not rp.padding.get("clean", True):
        warnings_.append("PFFDTD domain NOT edge-clean (see padding)")

    # geometric acoustics
    ga, walls, edges, silent = None, [], [], set()
    if rp.ga is not None:
        ga = ga_scene(rp.ga, rp.ga_geo, rp.ga_pairs_data)
        walls = ga_walls(ga, rp, K.PRA_SHELL_KEY)
        edges = ga.edges
        silent = _components_without_edges(walls, ga.scene_edges, ground_key) if rp.ga.diffracts else set()
    shell_key = K.PRA_SHELL_KEY
    objects = [w for w in walls if w["key"] not in (shell_key, ground_key) or w["obstacle"]]
    boundary_objects = {w["component"] for w in objects if not w["obstacle"]}
    shadowed = [p.key for p in rp.pairs if not rp.geoms[p.key].line_of_sight]
    if rp.ga is not None and rp.ga.diffracts:
        if not ga.closed:
            problems.append("GA: model open (room-boundary edges not searched)")
        if boundary_objects:
            problems.append(f"GA: {len(boundary_objects)} object component(s) left in the room boundary")
        if silent:
            problems.append(f"GA: {len(silent)} obstacle component(s) give no diffracting edge")
        if shadowed and not ga.scene_edges:
            problems.append("GA: shadowed pairs but no diffracting edge")
        # compas_acoustics' own count: obstacles whose shape its edge search does not handle (their
        # edges may still be found in part, e.g. as room corners: see the magenta lines)
        problems += [f"GA (compas_acoustics): {w}" for w in ga.warnings if "neither closed-convex nor planar" in w]

    # figure
    fig = plt.figure(figsize=(22, 14), facecolor=STYLE["surface"])
    gs = fig.add_gridspec(2, 3, width_ratios=[1.0, 1.0, 0.95], hspace=0.12, wspace=0.08)
    vtitle = f" (staircase, h = {d.h * 1e3:.2f} mm)"
    for i, view in enumerate(VIEWS):
        _voxel_panel(fig.add_subplot(gs[0, i], projection="3d"), vox, colors, data, lo, hi, src, rcv, view, vtitle)
    gtitle = (f"{rp.ga.short_label()}: {len(walls) - sum(1 for w in walls if w['key'] == shell_key)} walls, "
              f"{len(ga.scene_edges)} diffracting edges ({'closed' if ga.closed else 'OPEN'} model)") if ga else "Geometric acoustics: off"
    for i, view in enumerate(VIEWS):
        _ga_panel(fig.add_subplot(gs[1, i], projection="3d"), walls, edges, silent, colors, data, lo, hi, src, rcv, view,
                  shell_key, gtitle)
    _plan_panel(fig.add_subplot(gs[0, 2]), data, rp, walls, edges, colors, src, rcv, shell_key)

    lines = [f"{scene.label}", f"fmax {opts.fmax:g} Hz, {len(rp.pairs)} pairs ({len(shadowed)} without line of sight)", "",
             "PFFDTD",
             f"  h = {d.h * 1e3:.2f} mm ({d.ppw_effective:.1f} ppw), grid {list(d.shape)} = {d.nodes / 1e6:.0f} M nodes",
             f"  GPU {d.gpu_gb:.1f} of {d.gpu_budget_gb:.1f} GB; {describe_padding(rp.padding)[:90]}"]
    if vox is not None:
        counts = {}
        for k in vox["keys"]:
            counts[k] = counts.get(k, 0) + 1
        lines.append(f"  {len(vox['keys']):,} boundary nodes: " + ", ".join(f"{k} {n:,}" for k, n in sorted(counts.items())))
        if clearance:
            worst = min(clearance, key=lambda t: t[1])
            lines.append(f"  seed clearance: min {worst[1]:.1f} cells ({worst[0]}), required {PFFDTD_SEED_CLEARANCE_CELLS:g}")
        lines.append(f"  voxel file {vox['file']}")
    elif vox_error:
        lines += _wrap("voxelisation failed: " + vox_error, 70)
    for m in rp.moved:
        lines.append(f"  {m['id']} raised to {m['simulated_z_m'] * 1e3:.0f} mm (clearance above the floor)")
    lines += ["", "Geometric acoustics"]
    if ga is not None:
        lines += _wrap(rp.ga.describe(), 76)
        n_obst = len({w['component'] for w in objects if w['obstacle']})
        lines += _wrap(f"{ga.describe()}; {n_obst} obstacle component(s), {len(boundary_objects)} object component(s) in the "
                       f"boundary, {len(silent)} obstacle(s) without edges", 76)
        length = sum(float(np.linalg.norm(np.asarray(b) - np.asarray(a))) for a, b, _ in ga.scene_edges)
        lines.append(f"  diffracting edges: {len(ga.scene_edges)}, {length:.1f} m in total")
        for w in ga.warnings:
            lines += _wrap("CA warning: " + w, 76)
    else:
        lines.append("  off")
    if shadowed:
        lines += ["", *_wrap("Shadowed pairs: " + ", ".join(shadowed), 78, "")]
    lines += ["", "Materials (absorption at 500 Hz / 1 kHz)"]
    for key, mi in scene.materials.items():
        c = rp.coeffs.get(key, {})
        name = Path(mi.csv).name if mi.csv else f"constant {mi.alpha:g}"
        lines.append(f"  {key}: {name[:38]}  {_alpha_at(c, 500):.3f} / {_alpha_at(c, 1000):.3f}")
    lines += ["", "PROBLEMS" if problems else "No problem found.", *[f"  - {p}" for p in problems],
              *[f"  - (warning) {w}" for w in warnings_]]
    _text_panel(fig.add_subplot(gs[1, 2]), lines)

    handles = [Patch(color=colors[k], label=k) for k in scene.materials] + [Patch(color=RIGID_COLOR, label="rigid (PFFDTD)")]
    handles += [Patch(facecolor="none", edgecolor=BOUNDARY_OBJECT_COLOR, hatch="xxx", label="object left in the boundary"),
                Patch(facecolor="none", edgecolor=BOUNDARY_OBJECT_COLOR, label="obstacle without edges"),
                plt.Line2D([], [], color=EDGE_COLOR, lw=2, label="diffracting edge"),
                plt.Line2D([], [], color=SHADOW_COLOR, lw=1, ls="--", label="shadowed pair"),
                plt.Line2D([], [], marker="^", ls="", color=SOURCE_COLOR, label="loudspeaker (arrow: aim)"),
                plt.Line2D([], [], marker="o", ls="", color=RECEIVER_COLOR, label="microphone")]
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), frameon=False, fontsize=8, bbox_to_anchor=(0.5, 0.965))
    fig.suptitle(f"{scene.name}: geometry check before simulation, fmax {opts.fmax:g} Hz", fontsize=14, color=STYLE["ink"], y=0.99)
    fig.subplots_adjust(top=0.93, bottom=0.03, left=0.02, right=0.99)
    path = out_dir / f"{scene.name}_f{opts.fmax:g}.png"
    out_dir.mkdir(parents=True, exist_ok=True)
    _save(fig, path)
    plt.close(fig)
    return {"scene": scene.name, "fmax": opts.fmax, "h_mm": d.h * 1e3, "png": path.name, "problems": problems,
            "warnings": warnings_, "edges": len(ga.scene_edges) if ga else None, "walls": ga.describe().split(",")[0] if ga else None, "closed": ga.closed if ga else None,
            "nodes": len(vox["keys"]) if vox is not None else None,
            # the geometric-acoustics run's cache key: equal at every stage when its scene is stage-independent
            "ga_hash": _ga_hash(rp.ga, rp.ga_geo, rp.ga_pairs_data)[:10] if rp.ga is not None else None}


def _save(fig, path: Path, tries: int = 5) -> None:
    """Write next to ``path`` and swap it in: on Windows a viewer or the indexer can hold the old figure
    for a moment (``OSError: [Errno 22] Invalid argument``)."""
    tmp = path.with_name(path.stem + ".tmp.png")
    from benchmarks.bras.bras_plots import DPI, STYLE

    fig.savefig(tmp, dpi=DPI, facecolor=STYLE["surface"])
    for attempt in range(tries):
        try:
            os.replace(tmp, path)
            return
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(1.0 + attempt)


def write_index(rows: list, out_dir: Path) -> Path:
    """``index.md`` of every figure in ``out_dir``: this run's rows replace earlier ones of the same
    scene + stage (kept in ``index.json``), so a partial re-run keeps the others."""
    from benchmarks.bras.scenes import SCENES

    store = out_dir / "index.json"
    merged = {}
    if store.exists():
        try:
            merged = {(r["scene"], float(r["fmax"])): r for r in json.loads(store.read_text(encoding="utf-8"))}
        except Exception:  # an unreadable index is rebuilt from this run
            merged = {}
    merged.update({(r["scene"], float(r["fmax"])): r for r in rows})
    order = {name: i for i, name in enumerate(SCENES)}
    rows = sorted(merged.values(), key=lambda r: (order.get(r["scene"], 1e9), float(r["fmax"])))
    out_dir.mkdir(parents=True, exist_ok=True)
    store.write_text(json.dumps(rows, indent=1, default=str), encoding="utf-8")
    lines = ["# BRAS geometry check (before simulation)", "",
             "GA scene: the geometric-acoustics run's cache key (geometry, positions, settings); it must be the same "
             "at every stage of a scene.", "",
             "| Scene | fmax (Hz) | h (mm) | PFFDTD boundary nodes | GA model | GA walls | Diffracting edges | GA scene "
             "| Problems | Figure |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    keys: dict = {}
    for r in rows:
        if r.get("ga_hash"):
            keys.setdefault(r["scene"], set()).add(r["ga_hash"])
    for r in rows:
        if r.get("error"):
            lines.append(f"| {r['scene']} | {r.get('fmax', 0):g} | - | - | - | - | - | - | FAILED: {r['error']} | - |")
            continue
        model = "-" if r["closed"] is None else ("closed" if r["closed"] else "**open**")
        stage_bound = ["GA scene differs between stages"] if len(keys.get(r["scene"], ())) > 1 else []
        probs = "<br>".join(r["problems"] + stage_bound + [f"(warning) {w}" for w in r["warnings"]]) or "none"
        nodes = f"{r['nodes']:,}" if r["nodes"] is not None else "-"
        lines.append(f"| {r['scene']} | {r['fmax']:g} | {r['h_mm']:.2f} | {nodes} | {model} | {r.get('walls', '-')} "
                     f"| {r['edges']} | `{r.get('ga_hash') or '-'}` | {probs} | [png]({r['png']}) |")
    path = out_dir / INDEX
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes", nargs="*", default=[], help="scene names or patterns (default: every reference scene)")
    ap.add_argument("--stages", nargs="*", default=["all"], help="fmax stages in Hz (default: all of each scene)")
    ap.add_argument("--no-voxels", action="store_true", help="skip the PFFDTD voxelisation")
    ap.add_argument("--ga-ray-tracing", choices=("on", "off", "scene"), default="scene")
    ap.add_argument("--ga-diffraction", choices=("udfa", "off"), default=None)
    ap.add_argument("--voxelise-job", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.voxelise_job:   # compas-pffdtd side
        return _voxelise_job(args.voxelise_job)

    import warnings

    warnings.simplefilter("ignore")
    from benchmarks.bras import bras_constants as K
    from benchmarks.bras.bras_benchmark import RunOptions, ga_ray_tracing_arg, load_scene
    from benchmarks.bras.bras_pra import env_diffraction
    from benchmarks.bras.run_all import select_scenes

    out_dir = K.OUTPUT_ROOT / CHECK_DIR
    rows = []
    for name in select_scenes(args.scenes):
        try:
            data = load_scene(__import__("benchmarks.bras.scenes", fromlist=["SCENES"]).SCENES[name])
        except Exception as exc:
            traceback.print_exc()
            rows.append({"scene": name, "fmax": 0.0, "error": str(exc)[:160]})
            continue
        bt = data.scene.band_test
        fmaxes = list(bt.stages) if args.stages == ["all"] else [float(s) for s in args.stages if float(s) in bt.stages]
        for fmax in fmaxes:
            t0 = time.time()
            opts = RunOptions(fmax=fmax, ppw=bt.stages[fmax], pair_keys=[p.key for p in data.measured],
                              ga_ray_tracing=ga_ray_tracing_arg(args.ga_ray_tracing),
                              ga_diffraction=args.ga_diffraction or env_diffraction())
            try:
                row = check_stage(data, opts, out_dir, voxels=not args.no_voxels)
                rows.append(row)
                print(f"[check] {name} f{fmax:g}: {len(row['problems'])} problem(s), {time.time() - t0:.0f} s -> "
                      f"{out_dir / row['png']}", flush=True)
            except Exception as exc:
                traceback.print_exc()
                rows.append({"scene": name, "fmax": fmax, "error": str(exc).splitlines()[0][:160]})
            write_index(rows, out_dir)
    print(f"index -> {write_index(rows, out_dir)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
