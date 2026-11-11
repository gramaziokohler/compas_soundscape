"""Padded free-field domain around the objects: whole grid cells, sized for the analysis gate.

The grid spacing is planned here (aligned to the objects, and to the floor of a hemi-anechoic
scene) and passed to the job explicitly, so the measured-scene run and its empty-domain control run
share one grid even though the floor spans the whole domain.

The free air on each domain face comes from geometry and arrival times (``edge_padding_m``): the
control run removes the domain-edge echo exactly, except where the edge wave also meets an object,
so every such path must reach the microphones after the analysis window.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np

from benchmarks.bras.bras_constants import GROUND_BELOW_CELLS, GROUND_TOL_M
from config.constants import PFFDTD_SPEED_OF_SOUND
from utils.pffdtd_grid import plan_grid


@dataclass
class DomainPlan:
    h: float
    ppw_effective: float
    misalignment_cells: list
    bmin: list
    bmax: list
    shape: list
    nodes: int
    gpu_gb: float
    gpu_budget_gb: float
    fits_gpu: bool
    est_runtime_s: float          # per engine run

    def as_dict(self) -> dict:
        return asdict(self)


def gate_padding_m(d_max: float, t_gate: float, c: float = PFFDTD_SPEED_OF_SOUND) -> float:
    """Distance from a domain face that delays its echo past ``t_gate`` for a pair ``d_max`` apart
    (source and receiver both ``D`` from a face parallel to their line)."""
    return math.sqrt(((d_max + c * t_gate) ** 2 - d_max ** 2) / 4.0)


def alignment_box(obj_bmin, obj_bmax, ground_z: Optional[float]) -> tuple[np.ndarray, np.ndarray]:
    """The box the grid is aligned to: the objects, extended down to the floor."""
    lo, hi = np.asarray(obj_bmin, np.float64).copy(), np.asarray(obj_bmax, np.float64).copy()
    if ground_z is not None:
        if ground_z > lo[2] + GROUND_TOL_M:
            raise ValueError(f"Ground at z = {ground_z} m is above the objects' bottom ({lo[2]:.3f} m)")
        lo[2] = ground_z
    return lo, hi


def face_padding(padding_m) -> tuple[np.ndarray, np.ndarray]:
    """``padding_m`` as (below, above) per axis: one number for every face, or a pair of 3-vectors."""
    if np.ndim(padding_m) == 0:
        return np.full(3, float(padding_m)), np.full(3, float(padding_m))
    pad_lo, pad_hi = padding_m
    return np.asarray(pad_lo, np.float64).reshape(3), np.asarray(pad_hi, np.float64).reshape(3)


def _surface_points(vertices: np.ndarray, faces: np.ndarray, spacing: float) -> np.ndarray:
    """Points on every triangle, no point of a triangle farther than ``spacing`` from one of them."""
    tri = np.asarray(vertices, np.float64)[np.asarray(faces)]
    edge = np.max(np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2), axis=1)
    out = [np.asarray(vertices, np.float64)]
    for n in np.unique(np.maximum(1, np.ceil(edge / spacing)).astype(int)):
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = i + j <= n
        w = np.stack([i[keep], j[keep], n - i[keep] - j[keep]], axis=1) / n          # barycentric grid
        t = tri[np.ceil(edge / spacing).clip(min=1).astype(int) == n]
        out.append(np.einsum("kb,tbd->tkd", w, t).reshape(-1, 3))
    return np.unique(np.vstack(out).round(6), axis=0)


def edge_padding_m(pairs: list, window_s: float, objects: Optional[tuple] = None, ground_z: Optional[float] = None,
                   keep_s: float = 0.0, c: float = PFFDTD_SPEED_OF_SOUND, sample_m: float = 0.1,
                   search_m: float = 60.0) -> tuple[np.ndarray, np.ndarray]:
    """Free air per domain face (below, above per axis, beyond the devices and the objects) that keeps
    the domain edge out of every analysis window.

    The empty-domain control run removes the edge echo exactly (the solver is linear), except where
    the edge wave also meets an object. With S' (R') mirrored across a face, any such path is at
    least ``min_X |S' - X| + |X - R|`` (face first) or ``|S - X| + |X - R'|`` (object first) long:
    an unfolded reflection never shortens a path. Each face is moved out until those arrive
    ``window_s`` after the direct sound, for every pair (``(source, receiver)`` positions).
    ``objects`` = (vertices, faces), sampled every ``sample_m`` (the bound subtracts 2 x sample_m).
    The pure edge echo (``|S' - R|``) must also come ``keep_s`` after the floor reflection, so the
    control run keeps its whole physical part. The face under a floor is shielded (0).
    """
    S = np.array([s for s, _ in pairs], np.float64)
    R = np.array([r for _, r in pairs], np.float64)
    X = _surface_points(*objects, sample_m) if objects is not None and len(objects[1]) else np.zeros((0, 3))
    d = np.linalg.norm(R - S, axis=1)
    floor = np.zeros(len(S))
    if ground_z is not None:
        img = S.copy()
        img[:, 2] = 2.0 * ground_z - S[:, 2]
        floor = np.linalg.norm(R - img, axis=1) - d
    need_obj = d + c * window_s + 2.0 * sample_m
    need_echo = d + floor + c * keep_s
    pts = np.vstack([S, R] + ([X] if len(X) else []))
    lo, hi = pts.min(axis=0), pts.max(axis=0)

    def clean(k: int, plane: float) -> bool:
        Sm, Rm = S.copy(), R.copy()
        Sm[:, k] = 2.0 * plane - S[:, k]
        Rm[:, k] = 2.0 * plane - R[:, k]
        if np.any(np.linalg.norm(R - Sm, axis=1) < need_echo):
            return False
        for a, b in ((Sm, R), (S, Rm)):   # face then object, object then face
            for i in range(len(S)):
                if len(X) and (np.linalg.norm(X - a[i], axis=1) + np.linalg.norm(X - b[i], axis=1)).min() < need_obj[i]:
                    return False
        return True

    pad_lo, pad_hi = np.zeros(3), np.zeros(3)
    for k in range(3):
        for side, base, out in ((-1.0, lo[k], pad_lo), (1.0, hi[k], pad_hi)):
            if side < 0 and k == 2 and ground_z is not None:
                continue
            a, b = 0.0, search_m
            if not clean(k, base + side * b):
                raise ValueError(f"no padding up to {search_m:g} m clears the window on axis {k}")
            while b - a > 0.01:
                mid = 0.5 * (a + b)
                a, b = (a, mid) if clean(k, base + side * mid) else (mid, b)
            out[k] = b
    return pad_lo, pad_hi


def describe_padding(padding: dict) -> str:
    """One line for reports: free air per face, and what gave way when the GPU was too small."""
    def faces(lo, hi):
        return ", ".join(f"{ax} {'floor' if (ax == 'z' and lo[2] == 0.0) else f'{lo[k]:.2f}'} / {hi[k]:.2f}"
                         for k, ax in enumerate("xyz"))
    text = f"free air below / above (m): {faces(padding['lo'], padding['hi'])}"
    if padding["ppw"] < padding["ppw_requested"] - 1e-9:
        text += (f"; grid coarsened from {padding['ppw_effective_requested']:.1f} to {padding['ppw_effective']:.1f} "
                 f"points per wavelength at fmax to fit the GPU")
    if not padding["clean"]:
        text += (f"; NOT edge-clean: less than the {faces(padding['required_lo'], padding['required_hi'])} m needed, "
                 f"an edge wave that meets an object may reach the {padding['window_ms']:.0f} ms window")
    return text


def padded_bounds(lo, hi, points, h: float, padding_m, ground_z: Optional[float] = None) -> tuple[list, list]:
    """Bounds >= ``padding_m`` (one number, or per face: see ``face_padding``) beyond every point, a
    whole number of cells from the box ``lo..hi``.

    PFFDTD's CartGrid puts the domain minimum on a cell face, so whole cells keep the faces the
    spacing was aligned to on cell faces. With a floor, the domain stops GROUND_BELOW_CELLS under it.
    """
    lo, hi = np.asarray(lo, np.float64), np.asarray(hi, np.float64)
    pts = np.vstack([np.asarray(points, np.float64).reshape(-1, 3), lo, hi])
    pad_lo, pad_hi = face_padding(padding_m)
    want_lo, want_hi = pts.min(axis=0) - pad_lo, pts.max(axis=0) + pad_hi
    n_lo = np.ceil((lo - want_lo) / h - 1e-9)
    n_hi = np.ceil((want_hi - hi) / h - 1e-9)
    if ground_z is not None:
        n_lo[2] = GROUND_BELOW_CELLS
    return (lo - n_lo * h).tolist(), (hi + n_hi * h).tolist()


def domain_plan(obj_bmin, obj_bmax, points, fmax: float, ppw: float, duration: float, padding_m,
                ground_z: Optional[float] = None) -> DomainPlan:
    lo, hi = alignment_box(obj_bmin, obj_bmax, ground_z)
    h = plan_grid(hi - lo, fmax, ppw, duration).h
    bmin, bmax = padded_bounds(lo, hi, points, h, padding_m, ground_z)
    plan = plan_grid(hi - lo, fmax, ppw, duration, domain_extents=np.subtract(bmax, bmin), h=h)
    return DomainPlan(
        h=plan.h, ppw_effective=plan.ppw_effective, misalignment_cells=plan.misalignment_cells,
        bmin=bmin, bmax=bmax, shape=list(plan.shape), nodes=plan.nodes, gpu_gb=plan.gpu_bytes / 1e9,
        gpu_budget_gb=plan.gpu_budget_bytes / 1e9, fits_gpu=plan.fits_gpu, est_runtime_s=plan.est_runtime_s,
    )
