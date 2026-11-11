"""Setup figure of a benchmark: the same layout for every BRAS scene, so the RS setups compare side by side.

``plots/setup.png``, rows:

1. The geometry as simulated (faces coloured by material, floor, loudspeakers with their aiming
   direction, microphones): plan (top view), section (the vertical grid plane through the level
   calibration pair; faces cut by it in ink, the rest behind it in light colour), perspective.
2. What each engine gets: the PFFDTD boundary nodes on the run's own grid (plan slice through the
   objects, the same section plane), and the pyroomacoustics walls (after the app's coplanar merge;
   two-sided walls hatched).
3. The materials: absorption and scattering exactly as read from the BRAS CSVs (third octaves),
   the compared band shaded; the run's numbers (grid, domain, engines).
4. The absorption values of the compared band, per material.

PFFDTD voxels come from the solver's voxel cache (``PFFDTD_VOXEL_CACHE_DIR``), keyed as
``sim_prepare._vox_cache_path`` keys it. ``capture_voxel_slices`` runs right after the PFFDTD run
(the cache keeps 16 entries) and stores the two slices in ``plots/setup_voxels.npz``. When the
cache entry is gone (an old run), the slices are the geometry cut rasterised on the run's grid,
and the figure says so.

Standalone, without the GPU (from backend/, compas-toy python):

    python tests/benchmarks/bras/bras_setup_plots.py --scenes RS7 "RS2*" [--fmax 2500]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Optional

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
for _p in (str(_TESTS.parent), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection, PolyCollection  # noqa: E402
from matplotlib.colors import ListedColormap  # noqa: E402
from matplotlib.patches import Patch, Rectangle  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

from benchmarks.bras.bras_geometry import load_bras_material_csv  # noqa: E402
from benchmarks.bras.bras_plots import DPI, STYLE, _style_axes  # noqa: E402
from benchmarks.bras.bras_scene import source_forward  # noqa: E402

SETUP_PNG = "setup.png"
VOXELS_NPZ = "setup_voxels.npz"
# categorical slots for the materials (fixed order), the floor gets its own neutral colour
MATERIAL_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#9b5de5", "#e3b505", "#e34948", "#3bb5c9", "#8a6d3b"]
FLOOR_COLOR = "#d9d4c7"
RIGID_COLOR = "#52514e"
SOURCE_COLOR = "#e34948"
RECEIVER_COLOR = "#0b0b0b"
VIEW_MARGIN_M = 0.4        # around the objects and the seeds
ARROW_M = 0.35             # loudspeaker aiming arrow
# must match pffdtd_backend/sim_prepare.py (GRID_OFFSET_CELLS, VOX_CACHE_VERSION)
GRID_OFFSET_CELLS = 3.5
VOX_CACHE_VERSION = 2


# ── geometry helpers ────────────────────────────────────────────────────────

def _material_colors(keys: list, ground_key: Optional[str]) -> dict:
    out, i = {}, 0
    for k in keys:
        if k == ground_key:
            out[k] = FLOOR_COLOR
        else:
            out[k] = MATERIAL_COLORS[i % len(MATERIAL_COLORS)]
            i += 1
    return out


def _seeds(rp) -> tuple[dict, dict]:
    """Simulated positions (after the floor-clearance move): sources and receivers by id."""
    src, rcv = {}, {}
    for p in (rp.sim_pairs or rp.pairs):
        src[p.source_id] = np.asarray(p.source_position, np.float64)
        rcv[p.receiver_id] = np.asarray(p.receiver_position, np.float64)
    return src, rcv


def _view_box(mesh, seeds: list, ground_z: Optional[float]) -> tuple[np.ndarray, np.ndarray]:
    pts = [np.asarray(s) for s in seeds]
    if not mesh.empty:
        pts += [mesh.bmin, mesh.bmax]
    pts = np.vstack(pts)
    lo, hi = pts.min(axis=0) - VIEW_MARGIN_M, pts.max(axis=0) + VIEW_MARGIN_M
    if ground_z is not None:
        lo[2] = ground_z - 0.05
    return lo, hi


def section_plane(rp, scene) -> tuple[int, float, str]:
    """Axis-aligned vertical plane through the level calibration pair: (axis, coordinate, name).

    axis 1 = the plane y = c (an x-z section), axis 0 = x = c (a y-z section)."""
    pair = next((p for p in (rp.sim_pairs or rp.pairs) if p.key == scene.gain_pair), (rp.sim_pairs or rp.pairs)[0])
    s, r = np.asarray(pair.source_position), np.asarray(pair.receiver_position)
    d = r - s
    axis = 1 if abs(d[0]) >= abs(d[1]) else 0
    c = float(0.5 * (s[axis] + r[axis]))
    return axis, c, pair.key


def plan_height(mesh, ground_z: Optional[float], h: float) -> float:
    """Plan slice height: through the middle of the objects (above the floor's own cells)."""
    if mesh.empty:
        return (ground_z or 0.0) + 2 * h
    z = 0.5 * (mesh.bmin[2] + mesh.bmax[2])
    return max(z, (ground_z if ground_z is not None else -np.inf) + 2 * h)


def _cut_segments(tris: np.ndarray, axis: int, c: float) -> np.ndarray:
    """Segments where triangles (T, 3, 3) cross the plane x[axis] = c: (S, 2, 3)."""
    d = tris[:, :, axis] - c
    out = []
    for t, dv in zip(tris, d):
        pts = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            if (dv[i] < 0) != (dv[j] < 0) and dv[i] != dv[j]:
                a = dv[i] / (dv[i] - dv[j])
                pts.append(t[i] + a * (t[j] - t[i]))
            elif dv[i] == 0:
                pts.append(t[i])
        if len(pts) >= 2:
            out.append([pts[0], pts[1]])
    return np.asarray(out, np.float64).reshape(-1, 2, 3)


def _clip_polygon(poly: np.ndarray, lo, hi) -> np.ndarray:
    """Sutherland-Hodgman against an axis-aligned box (3D polygon, (N, 3))."""
    for axis in range(3):
        for bound, sign in ((lo[axis], 1.0), (hi[axis], -1.0)):
            if len(poly) == 0:
                return poly
            out = []
            for i in range(len(poly)):
                a, b = poly[i - 1], poly[i]
                ina, inb = sign * (a[axis] - bound) >= 0, sign * (b[axis] - bound) >= 0
                if inb:
                    if not ina:
                        out.append(a + (bound - a[axis]) / (b[axis] - a[axis]) * (b - a))
                    out.append(b)
                elif ina:
                    out.append(a + (bound - a[axis]) / (b[axis] - a[axis]) * (b - a))
            poly = np.asarray(out, np.float64).reshape(-1, 3)
    return poly


def _floor_tris(scene, lo, hi) -> list:
    if scene.ground is None:
        return []
    z = scene.ground.z
    return [np.array([[lo[0], lo[1], z], [hi[0], lo[1], z], [hi[0], hi[1], z], [lo[0], hi[1], z]])]


# ── PFFDTD voxels ───────────────────────────────────────────────────────────

def _cart_grid(h: float, bmin, bmax) -> tuple[np.ndarray, np.ndarray]:
    """``voxelizer.cart_grid.CartGrid``: (Nxyz, xyzmin) of a padded domain."""
    x0 = np.asarray(bmin, np.float64) - GRID_OFFSET_CELLS * h
    x1 = np.asarray(bmax, np.float64) + GRID_OFFSET_CELLS * h
    return np.int_(np.ceil((x1 - x0) / h)) + 1, x0


def _voxel_cache_files(rp) -> tuple[list, dict, tuple]:
    """Cache files of this run's voxelisation (cut-cell first), material name -> scene key, grid."""
    from config.constants import PFFDTD_VOXEL_CACHE_DIR
    from services.pffdtd_job import prepare_pffdtd_mesh
    from services.pffdtd_scene_export import build_scene

    mesh, _ = prepare_pffdtd_mesh(rp.scene_geo, rp.pairs_data, None)
    mats_hash, _ = build_scene(mesh)
    names = {}
    for fi, name in _face_names(mesh).items():
        names.setdefault(name, fi)
    by_json = {json.dumps(v, sort_keys=True, default=str): k for k, v in rp.coeffs.items()}
    name_key = {name: by_json.get(json.dumps(mesh.face_material[fi], sort_keys=True, default=str), name)
                for name, fi in names.items()}
    h = float(rp.domain.h)
    N, x0 = _cart_grid(h, *rp.bounds)
    digest = hashlib.sha1()
    digest.update(json.dumps(mats_hash, sort_keys=True).encode())
    digest.update(repr((VOX_CACHE_VERSION, h, False, [int(n) for n in N], x0.tolist())).encode())
    base = Path(PFFDTD_VOXEL_CACHE_DIR) / f"vox_{digest.hexdigest()}.npz"
    files = sorted(base.parent.glob(f"{base.stem}_cut_*.npz")) + ([base] if base.exists() else [])
    return files, name_key, (h, N, x0)


def _face_names(mesh) -> dict:
    """Face index -> the material name build_scene gives it (m000, m001, ... in order of appearance)."""
    keys, out = {}, {}
    for fi in range(len(mesh.faces)):
        k = json.dumps(mesh.face_material[fi], sort_keys=True, default=str)
        keys.setdefault(k, f"m{len(keys):03d}")
        out[fi] = keys[k]
    return out


def _slice_mask(ixyz: np.ndarray, mat: np.ndarray, axis: int, index: int, shape2: tuple) -> np.ndarray:
    """Boundary nodes on one grid plane, (rows, cols): 0 air, -1 rigid, material index + 1."""
    sel = ixyz[:, axis] == index
    other = [a for a in range(3) if a != axis]
    img = np.zeros(shape2, np.int16)
    img[ixyz[sel, other[1]], ixyz[sel, other[0]]] = np.where(mat[sel] < 0, -1, mat[sel] + 1)
    return img


def capture_voxel_slices(rp, data, path: Path) -> Optional[Path]:
    """The PFFDTD boundary nodes on the plan and section planes, from the run's voxel cache entry."""
    files, name_key, (h, N, x0) = _voxel_cache_files(rp)
    if not files:
        return None
    vox = np.load(files[0])
    ixyz = np.stack(np.unravel_index(np.asarray(vox["bn_ixyz"], np.int64), tuple(int(n) for n in N)), axis=1)
    mat = np.asarray(vox["mat_bn"], np.int64)
    scene, mesh = data.scene, data.mesh
    ground_z = scene.ground.z if scene.ground is not None else None
    axis, c, _ = section_plane(rp, scene)
    zc = plan_height(mesh, ground_z, h)
    iz = int(round((zc - x0[2]) / h))
    ia = int(round((c - x0[axis]) / h))
    plan = _slice_mask(ixyz, mat, 2, iz, (int(N[1]), int(N[0])))
    sec_other = 0 if axis == 1 else 1
    sec = _slice_mask(ixyz, mat, axis, ia, (int(N[2]), int(N[sec_other])))
    names = sorted(name_key)   # RoomGeo processes the materials alphabetically: mat_bn indexes this list
    np.savez_compressed(path, plan=plan, section=sec, h=h, N=N, x0=x0, axis=axis, plan_z=x0[2] + iz * h,
                        section_c=x0[axis] + ia * h, names=np.array([name_key[n] for n in names]),
                        source=np.array(files[0].name), cut_cells=np.array("_cut_" in files[0].name))
    return path


def _rasterised_slices(rp, data) -> dict:
    """Fallback without the cache: the geometry cut by each plane, rasterised on the run's grid."""
    scene, mesh = data.scene, data.mesh
    h = float(rp.domain.h)
    N, x0 = _cart_grid(h, *rp.bounds)
    ground_z = scene.ground.z if scene.ground is not None else None
    axis, c, _ = section_plane(rp, scene)
    zc = plan_height(mesh, ground_z, h)
    keys = list(scene.materials)
    tris = mesh.vertices[mesh.faces] if not mesh.empty else np.zeros((0, 3, 3))
    tri_key = np.array([keys.index(m) + 1 for m in mesh.materials], np.int16)

    def raster(ax, cv, shape2, other):
        img = np.zeros(shape2, np.int16)
        for (a, b), k in zip(*_cut_with_ids(tris, tri_key, ax, cv)):
            n = int(np.ceil(np.linalg.norm(b - a) / (0.25 * h))) + 1
            p = a + np.linspace(0, 1, n)[:, None] * (b - a)
            i = np.clip(np.round((p[:, other[0]] - x0[other[0]]) / h).astype(int), 0, shape2[1] - 1)
            j = np.clip(np.round((p[:, other[1]] - x0[other[1]]) / h).astype(int), 0, shape2[0] - 1)
            img[j, i] = k
        return img

    plan = raster(2, zc, (int(N[1]), int(N[0])), (0, 1))
    so = 0 if axis == 1 else 1
    sec = raster(axis, c, (int(N[2]), int(N[so])), (so, 2))
    if ground_z is not None:   # the floor is a plane of the section: one row of nodes
        sec[int(round((ground_z - x0[2]) / h)), :] = keys.index(scene.ground.material) + 1
    return {"plan": plan, "section": sec, "h": h, "N": N, "x0": x0, "axis": axis, "plan_z": zc, "section_c": c,
            "names": np.array(keys), "source": np.array("geometry cut rasterised on the run's grid (no voxel cache)"),
            "cut_cells": np.array(False)}


def _cut_with_ids(tris, ids, axis, c):
    segs, out_ids = [], []
    for t, k in zip(tris, ids):
        s = _cut_segments(t[None], axis, c)
        if len(s):
            segs.append(s[0])
            out_ids.append(k)
    return segs, out_ids


def load_voxel_slices(rp, data, plots_dir: Path) -> dict:
    path = plots_dir / VOXELS_NPZ
    if not path.exists():
        try:
            capture_voxel_slices(rp, data, path)
        except Exception as exc:  # never fail a benchmark on a figure
            print(f"[bras] voxel slices from the cache failed: {exc}")
    if path.exists():
        with np.load(path) as z:
            return {k: z[k] for k in z.files}
    return _rasterised_slices(rp, data)


# ── pyroomacoustics walls ───────────────────────────────────────────────────

def pra_walls(rp) -> list[tuple[np.ndarray, str, bool]]:
    """(corners, scene material key, two-sided) of each wall the pyroomacoustics run builds."""
    from services.simulation_mesh_service import MeshPrepOptions, MeshPrepSettings, SimulationMeshService

    g = rp.scene_geo
    mesh = SimulationMeshService.prepare(
        g["vertices"], g["faces"], g["object_face_ranges"], {int(k): v for k, v in g["face_materials"].items()},
        None, [p["source_position"] for p in rp.pairs_data] + [p["receiver_position"] for p in rp.pairs_data],
        MeshPrepOptions.from_settings(MeshPrepSettings()),
    )
    by_json = {json.dumps(v, sort_keys=True, default=str): k for k, v in rp.coeffs.items()}
    out = []
    for w in mesh.walls:
        f0 = int(w.faces[0])
        key = by_json.get(json.dumps(mesh.face_material[f0], sort_keys=True, default=str), "?")
        out.append((np.asarray(w.corners, np.float64), key, bool(mesh.two_sided[f0])))
    return out


# ── panels ──────────────────────────────────────────────────────────────────

def _merged_labels(points: dict, ij: tuple) -> dict:
    """One label per projected point: "LS1/LS2" when several seeds coincide in this view."""
    groups: dict = {}
    for k, p in points.items():
        groups.setdefault((round(float(p[ij[0]]), 3), round(float(p[ij[1]]), 3)), []).append(k)
    return {ks[0]: "/".join(ks) for ks in groups.values()}


def _seed_marks(ax, src: dict, rcv: dict, ij: tuple, data, labels: bool = True) -> None:
    i, j = ij
    src_lab, rcv_lab = _merged_labels(src, ij), _merged_labels(rcv, ij)
    for sid, p in src.items():
        ax.plot(p[i], p[j], marker="^", ms=7, color=SOURCE_COLOR, mec="white", mew=0.6, zorder=6)
        fwd = source_forward(sid, p, data.source) if data.source.directivity is not None else None
        if fwd is not None and np.hypot(fwd[i], fwd[j]) > 1e-3:
            ax.annotate("", xy=(p[i] + ARROW_M * fwd[i], p[j] + ARROW_M * fwd[j]), xytext=(p[i], p[j]),
                        arrowprops=dict(arrowstyle="->", color=SOURCE_COLOR, lw=1.1), zorder=6)
        if labels and sid in src_lab:
            ax.annotate(src_lab[sid], (p[i], p[j]), xytext=(4, 4), textcoords="offset points", fontsize=7, color=SOURCE_COLOR)
    for rid, p in rcv.items():
        ax.plot(p[i], p[j], marker="o", ms=5, color=RECEIVER_COLOR, mec="white", mew=0.6, zorder=6)
        if labels and rid in rcv_lab:
            ax.annotate(rcv_lab[rid], (p[i], p[j]), xytext=(4, -9), textcoords="offset points", fontsize=7, color=RECEIVER_COLOR)


def _axes_2d(ax, lo, hi, ij, title: str) -> None:
    i, j = ij
    _style_axes(ax)
    ax.set_xlim(lo[i], hi[i])
    ax.set_ylim(lo[j], hi[j])
    ax.set_aspect("equal")
    names = "xyz"
    ax.set_xlabel(f"{names[i]} (m)")
    ax.set_ylabel(f"{names[j]} (m)")
    ax.set_title(title, fontsize=9, loc="left")


def _plan(ax, data, rp, colors, lo, hi, src, rcv, sec) -> None:
    scene, mesh = data.scene, data.mesh
    for poly in _floor_tris(scene, lo, hi):
        ax.add_patch(Rectangle((poly[0, 0], poly[0, 1]), poly[1, 0] - poly[0, 0], poly[2, 1] - poly[1, 1],
                               color=colors[scene.ground.material], zorder=0))
    if not mesh.empty:
        tris = mesh.vertices[mesh.faces]
        order = np.argsort(tris[:, :, 2].max(axis=1))       # painter: higher faces on top
        ax.add_collection(PolyCollection(tris[order][:, :, :2], facecolors=[colors[mesh.materials[k]] for k in order],
                                         edgecolors=STYLE["ink"], linewidths=0.2, alpha=0.9, zorder=2))
    axis, c, key = sec
    if axis == 1:
        ax.axhline(c, color=STYLE["ink2"], ls="--", lw=0.8, zorder=5)
    else:
        ax.axvline(c, color=STYLE["ink2"], ls="--", lw=0.8, zorder=5)
    _seed_marks(ax, src, rcv, (0, 1), data)
    _axes_2d(ax, lo, hi, (0, 1), f"Plan (top view); dashed: section plane through {key}")


def _section(ax, data, colors, lo, hi, src, rcv, sec) -> None:
    scene, mesh = data.scene, data.mesh
    axis, c, key = sec
    i = 0 if axis == 1 else 1
    if scene.ground is not None:
        ax.axhspan(lo[2], scene.ground.z, color=colors[scene.ground.material], zorder=0)
    if not mesh.empty:
        tris = mesh.vertices[mesh.faces]
        # behind the plane (seen from the negative side), light
        ax.add_collection(PolyCollection(tris[:, :, [i, 2]], facecolors=[colors[m] for m in mesh.materials],
                                         edgecolors="none", alpha=0.18, zorder=1))
        segs, ids = _cut_with_ids(tris, np.arange(len(tris)), axis, c)
        if segs:
            ax.add_collection(LineCollection([s[:, [i, 2]] for s in segs], colors=[colors[mesh.materials[k]] for k in ids],
                                             linewidths=2.2, zorder=3))
    on_plane = 0.05
    _seed_marks(ax, {k: p for k, p in src.items() if abs(p[axis] - c) < on_plane},
                {k: p for k, p in rcv.items() if abs(p[axis] - c) < on_plane}, (i, 2), data)
    _seed_marks(ax, {k: p for k, p in src.items() if abs(p[axis] - c) >= on_plane},
                {k: p for k, p in rcv.items() if abs(p[axis] - c) >= on_plane}, (i, 2), data, labels=False)
    _axes_2d(ax, lo, hi, (i, 2), f"Section {'xyz'[axis]} = {c:.3f} m (cut in solid colour, the rest behind it light)")
    ax.set_aspect("auto")


def _set_3d(ax, lo, hi, title: str) -> None:
    ax.set_xlim(lo[0], hi[0])
    ax.set_ylim(lo[1], hi[1])
    ax.set_zlim(lo[2], hi[2])
    ax.set_box_aspect(np.maximum(hi - lo, 1e-3))
    ax.view_init(elev=24, azim=-58)
    ax.set_xlabel("x (m)", fontsize=7)
    ax.set_ylabel("y (m)", fontsize=7)
    ax.set_zlabel("z (m)", fontsize=7)
    ax.tick_params(labelsize=6)
    ax.set_facecolor(STYLE["surface"])
    for a in (ax.xaxis, ax.yaxis, ax.zaxis):
        a.pane.set_facecolor(STYLE["surface"])
        a.pane.set_edgecolor(STYLE["grid"])
    ax.set_title(title, fontsize=9, loc="left")


def _seeds_3d(ax, src, rcv, data) -> None:
    for sid, p in src.items():
        ax.scatter(*p, marker="^", s=40, color=SOURCE_COLOR, depthshade=False, zorder=3)
        fwd = source_forward(sid, p, data.source) if data.source.directivity is not None else None
        if fwd is not None:
            ax.quiver(*p, *(ARROW_M * fwd), color=SOURCE_COLOR, linewidth=1.0, arrow_length_ratio=0.25, zorder=3)
        ax.text(*p, f" {sid}", fontsize=6, color=SOURCE_COLOR)
    for rid, p in rcv.items():
        ax.scatter(*p, marker="o", s=18, color=RECEIVER_COLOR, depthshade=False, zorder=3)
        ax.text(*p, f" {rid}", fontsize=6, color=RECEIVER_COLOR)


def _floor_first(ax, floor_polys: list, color) -> None:
    """The floor as its own layer drawn before everything: matplotlib sorts 3D collections by their
    centroid depth, so one large floor quad would otherwise cover the objects on its far half. Seen
    from above (elev > 0), nothing is ever behind the floor."""
    ax.computed_zorder = False
    if floor_polys:
        ax.add_collection3d(Poly3DCollection(floor_polys, facecolors=color, edgecolors=STYLE["axis"],
                                             linewidths=0.3, zorder=0))


def _is_floor(poly: np.ndarray, ground_z: Optional[float]) -> bool:
    return ground_z is not None and bool(np.all(np.abs(poly[:, 2] - ground_z) < 1e-6))


def _perspective(ax, data, colors, lo, hi, src, rcv) -> None:
    scene, mesh = data.scene, data.mesh
    floor = _floor_tris(scene, lo, hi)
    _floor_first(ax, floor, colors[scene.ground.material] if floor else None)
    polys, fc = [], []
    if not mesh.empty:
        for t, m in zip(mesh.vertices[mesh.faces], mesh.materials):
            polys.append(t)
            fc.append(colors[m])
    if polys:
        ax.add_collection3d(Poly3DCollection(polys, facecolors=fc, edgecolors=STYLE["ink"], linewidths=0.1,
                                             alpha=0.85, zorder=1))
    _seeds_3d(ax, src, rcv, data)
    _set_3d(ax, lo, hi, "Perspective")


def _voxel_panel(ax, vox: dict, which: str, colors, keys: list, lo, hi, src, rcv, data) -> None:
    img = vox[which]
    names = [str(n) for n in vox["names"]]
    h, N, x0 = float(vox["h"]), vox["N"], vox["x0"]
    axis = int(vox["axis"])
    ij = (0, 1) if which == "plan" else ((0, 2) if axis == 1 else (1, 2))
    i, j = ij
    cmap = ListedColormap(["#00000000", RIGID_COLOR] + [colors.get(n, MATERIAL_COLORS[0]) for n in names])
    shown = np.where(img < 0, 1, np.where(img > 0, img + 1, 0))   # 0 air, 1 rigid, 2.. materials
    ext = (x0[i] - 0.5 * h, x0[i] + (N[i] - 0.5) * h, x0[j] - 0.5 * h, x0[j] + (N[j] - 0.5) * h)
    _style_axes(ax)
    ax.imshow(shown, origin="lower", extent=ext, cmap=cmap, vmin=0, vmax=len(names) + 1, interpolation="nearest",
              zorder=2)
    ax.grid(False)
    _seed_marks(ax, src, rcv, ij, data, labels=False)
    where = (f"z = {float(vox['plan_z']):.3f} m" if which == "plan" else f"{'xyz'[axis]} = {float(vox['section_c']):.3f} m")
    _axes_2d(ax, lo, hi, ij, f"PFFDTD boundary nodes, {which} slice at {where} (h = {h * 1e3:.2f} mm)")
    if which == "section":
        ax.set_aspect("auto")
    if not bool(vox["cut_cells"]) and "rasterised" in str(vox["source"]):
        ax.text(0.01, 0.01, "approximate: no voxel cache for this run", transform=ax.transAxes, fontsize=7,
                color=STYLE["div_pos"])


def _pra_panel(ax, walls, colors, lo, hi, src, rcv, data) -> None:
    ground_z = data.scene.ground.z if data.scene.ground is not None else None
    polys, fc, hatch_polys, floor, floor_fc = [], [], [], [], []
    for corners, key, two in walls:
        p = _clip_polygon(corners, lo, hi)
        if len(p) < 3:
            continue
        if _is_floor(p, ground_z):
            floor.append(p)                      # the floor and anything lying on it (e.g. object bottoms)
            floor_fc.append(colors.get(key, FLOOR_COLOR))
            continue
        polys.append(p)
        fc.append(colors.get(key, MATERIAL_COLORS[0]))
        if two:
            hatch_polys.append(p)
    order = np.argsort([-abs(np.cross(q[1] - q[0], q[2] - q[0])[2]) for q in floor])   # big floor first
    _floor_first(ax, [floor[k] for k in order], [floor_fc[k] for k in order])
    if polys:
        ax.add_collection3d(Poly3DCollection(polys, facecolors=fc, edgecolors=STYLE["ink"], linewidths=0.5, alpha=0.55,
                                             zorder=1))
    if hatch_polys:
        ax.add_collection3d(Poly3DCollection(hatch_polys, facecolors="none", edgecolors=STYLE["ink"], linewidths=0.4,
                                             hatch="////", zorder=2))
    _seeds_3d(ax, src, rcv, data)
    n_two = sum(1 for w in walls if w[2])
    _set_3d(ax, lo, hi, f"pyroomacoustics: {len(walls)} walls after the coplanar merge ({n_two} two-sided, hatched)")


def _materials_panel(ax, scene, colors, band) -> list:
    _style_axes(ax)
    rows = []
    for key, mi in scene.materials.items():
        if mi.csv is not None:
            m = load_bras_material_csv(mi.csv)
            f, a, s = np.asarray(m["center_freqs"]), np.asarray(m["absorption"]), m["scattering"]
            name = Path(mi.csv).name
        else:
            f, a, s, name = np.array([20.0, 20000.0]), np.array([mi.alpha, mi.alpha]), None, f"constant {mi.alpha:g}"
        col = colors[key]
        ax.plot(f, a, color=col, lw=1.6, marker="o", ms=2.5, label=f"{key}: {name}")
        if s is not None:
            ax.plot(f, s, color=col, lw=1.0, ls="--")
        rows.append((key, name, f, a))
    ax.axvspan(*band, color=STYLE["band"], zorder=0)
    ax.set_xscale("log")
    ax.set_xlim(20, 20000)
    ax.set_ylim(0, 1.0)
    ax.set_xticks([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000])
    ax.set_xticklabels(["31.5", "63", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"])
    ax.set_xlabel("Frequency (Hz), third octaves")
    ax.set_ylabel("Coefficient")
    ax.set_title("Materials: absorption (solid) and scattering (dashed), as read from the BRAS CSVs; "
                 "compared band shaded", fontsize=9, loc="left")
    ax.legend(fontsize=7, frameon=False, loc="upper left")
    return rows


def _info_panel(ax, data, rp, vox: dict, n_walls: int) -> None:
    scene, d = data.scene, rp.domain
    ax.axis("off")
    lines = [
        scene.label, "",
        f"Chamber: {scene.chamber or ('hemi-anechoic' if scene.ground else 'anechoic')}",
        f"{scene.temperature_c:g} degC, {scene.humidity:g} % RH",
        f"Floor: {'z = %g m (%s)' % (scene.ground.z, scene.ground.material) if scene.ground else 'none'}",
        f"Objects: {len(data.mesh.faces)} triangles",
        "",
        "PFFDTD",
        f"  h = {d.h * 1e3:.2f} mm ({d.ppw_effective:.1f} points/wavelength at {rp.cfg.fmax:g} Hz)",
        f"  grid {list(d.shape)} = {d.nodes / 1e6:.0f} M nodes, {d.gpu_gb:.1f} GB",
        f"  domain {np.round(d.bmin, 2).tolist()} to",
        f"         {np.round(d.bmax, 2).tolist()} m",
        f"  free air below / above: x {rp.padding['lo'][0]:.1f}/{rp.padding['hi'][0]:.1f}, "
        f"y {rp.padding['lo'][1]:.1f}/{rp.padding['hi'][1]:.1f}, z {rp.padding['lo'][2]:.1f}/{rp.padding['hi'][2]:.1f} m"
        + ("" if rp.padding["clean"] else " (NOT edge-clean)"),
        f"  voxels: {str(vox['source'])[:48]}",
        "",
        "pyroomacoustics",
        f"  image sources to order {scene.pra.max_order}" + (" + ray tracing" if scene.pra.ray_tracing else ""),
        f"  {n_walls} walls; no diffraction",
        "",
        f"Level calibrated on {scene.gain_pair}; {len(rp.pairs)} pairs",
    ]
    ax.text(0.0, 1.0, "\n".join(lines), va="top", ha="left", fontsize=8, family="monospace", color=STYLE["ink"],
            transform=ax.transAxes)


def _table_panel(ax, rows, band) -> None:
    ax.axis("off")
    if not rows:
        return
    lo, hi = band
    f0 = rows[0][2]
    cols = [float(f) for f in f0 if lo / 1.12 <= f <= hi * 1.12]
    header = ["Material", "File"] + [f"{f / 1000:g}k" if f >= 1000 else f"{f:g}" for f in cols]
    body = []
    for key, name, f, a in rows:
        vals = [f"{np.interp(c, f, a):.3f}" for c in cols]
        body.append([key, name] + vals)
    t = ax.table(cellText=body, colLabels=header, loc="upper left", cellLoc="center", colLoc="center")
    t.auto_set_font_size(False)
    t.set_fontsize(7)
    t.scale(1.0, 1.3)
    n = len(header)
    widths = [0.13, 0.17] + [0.70 / (n - 2)] * (n - 2)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor(STYLE["grid"])
        cell.set_width(widths[c])
        if r == 0:
            cell.set_facecolor(STYLE["band"])
    ax.set_title("Absorption coefficient per third octave in the compared band (exact CSV values)", fontsize=9, loc="left")


def plot_setup(data, rp, plots_dir: Path, band: tuple) -> Path:
    """``plots/setup.png`` (and ``plots/setup_voxels.npz`` when it did not exist yet)."""
    scene, mesh = data.scene, data.mesh
    plots_dir.mkdir(parents=True, exist_ok=True)
    ground_key = scene.ground.material if scene.ground is not None else None
    keys = list(scene.materials)
    colors = _material_colors(keys, ground_key)
    src, rcv = _seeds(rp)
    ground_z = scene.ground.z if scene.ground is not None else None
    lo, hi = _view_box(mesh, list(src.values()) + list(rcv.values()), ground_z)
    sec = section_plane(rp, scene)
    vox = load_voxel_slices(rp, data, plots_dir)
    try:
        walls = pra_walls(rp)
    except Exception as exc:  # the figure must not fail a benchmark
        print(f"[bras] pyroomacoustics walls for the setup figure failed: {exc}")
        walls = []

    fig = plt.figure(figsize=(19, 19))
    gs = fig.add_gridspec(4, 3, height_ratios=[1.0, 1.0, 0.8, 0.32], hspace=0.32, wspace=0.18)
    _plan(fig.add_subplot(gs[0, 0]), data, rp, colors, lo, hi, src, rcv, sec)
    _section(fig.add_subplot(gs[0, 1]), data, colors, lo, hi, src, rcv, sec)
    _perspective(fig.add_subplot(gs[0, 2], projection="3d"), data, colors, lo, hi, src, rcv)
    _voxel_panel(fig.add_subplot(gs[1, 0]), vox, "plan", colors, keys, lo, hi, src, rcv, data)
    _voxel_panel(fig.add_subplot(gs[1, 1]), vox, "section", colors, keys, lo, hi, src, rcv, data)
    _pra_panel(fig.add_subplot(gs[1, 2], projection="3d"), walls, colors, lo, hi, src, rcv, data)
    rows = _materials_panel(fig.add_subplot(gs[2, 0:2]), scene, colors, band)
    _info_panel(fig.add_subplot(gs[2, 2]), data, rp, vox, len(walls))
    _table_panel(fig.add_subplot(gs[3, :]), rows, band)
    handles = [Patch(color=colors[k], label=k) for k in keys] + [Patch(color=RIGID_COLOR, label="rigid (PFFDTD)")]
    handles += [plt.Line2D([], [], marker="^", ls="", color=SOURCE_COLOR, label="loudspeaker (arrow: aim)"),
                plt.Line2D([], [], marker="o", ls="", color=RECEIVER_COLOR, label="microphone")]
    fig.subplots_adjust(top=0.95, bottom=0.03, left=0.05, right=0.97)
    fig.legend(handles=handles, loc="upper center", ncol=len(handles), frameon=False, fontsize=8,
               bbox_to_anchor=(0.5, 0.975))
    fig.suptitle(f"{scene.label}: setup at fmax {rp.cfg.fmax:g} Hz", fontsize=13, color=STYLE["ink"], y=0.99)
    path = plots_dir / SETUP_PNG
    fig.savefig(path, dpi=DPI, facecolor=STYLE["surface"])
    plt.close(fig)
    return path


# ── standalone ──────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    from fnmatch import fnmatch

    from benchmarks.bras.bras_analysis import metric_band
    from benchmarks.bras.bras_benchmark import RunOptions, load_scene, output_dir, plan_run
    from benchmarks.bras.scenes import RS_SCENES, SCENES

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes", nargs="*", default=[], help="scene names or patterns (default: every reference scene)")
    ap.add_argument("--fmax", type=float, default=None, help="stage (default: the last of each scene)")
    args = ap.parse_args(argv)
    names = [n for n in SCENES if any(fnmatch(n, p) for p in args.scenes)] if args.scenes else list(RS_SCENES)
    for name in names:
        data = load_scene(SCENES[name])
        bt = data.scene.band_test
        fmax = args.fmax or max(bt.stages)
        opts = RunOptions(fmax=fmax, ppw=bt.stages[fmax], pair_keys=[p.key for p in data.measured], animation=False)
        rp = plan_run(data, opts)
        path = plot_setup(data, rp, output_dir(data.scene, fmax) / "plots", metric_band(bt, fmax))
        print(f"{name}: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
