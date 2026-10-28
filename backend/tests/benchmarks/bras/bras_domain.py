"""Padded free-field domain around the objects: whole grid cells, sized for the analysis gate.

The grid spacing is planned here (aligned to the objects, and to the floor of a hemi-anechoic
scene) and passed to the job explicitly, so the measured-scene run and its empty-domain control run
share one grid even though the floor spans the whole domain.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np

from benchmarks.bras.bras_constants import GROUND_BELOW_CELLS
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
        if ground_z > lo[2] + 1e-9:
            raise ValueError(f"Ground at z = {ground_z} m is above the objects' bottom ({lo[2]:.3f} m)")
        lo[2] = ground_z
    return lo, hi


def padded_bounds(lo, hi, points, h: float, padding_m: float, ground_z: Optional[float] = None) -> tuple[list, list]:
    """Bounds >= ``padding_m`` beyond every point, a whole number of cells from the box ``lo..hi``.

    PFFDTD's CartGrid puts the domain minimum on a cell face, so whole cells keep the faces the
    spacing was aligned to on cell faces. With a floor, the domain stops GROUND_BELOW_CELLS under it.
    """
    lo, hi = np.asarray(lo, np.float64), np.asarray(hi, np.float64)
    pts = np.vstack([np.asarray(points, np.float64).reshape(-1, 3), lo, hi])
    want_lo, want_hi = pts.min(axis=0) - padding_m, pts.max(axis=0) + padding_m
    n_lo = np.ceil((lo - want_lo) / h - 1e-9)
    n_hi = np.ceil((want_hi - hi) / h - 1e-9)
    if ground_z is not None:
        n_lo[2] = GROUND_BELOW_CELLS
    return (lo - n_lo * h).tolist(), (hi + n_hi * h).tolist()


def domain_plan(obj_bmin, obj_bmax, points, fmax: float, ppw: float, duration: float, padding_m: float,
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
