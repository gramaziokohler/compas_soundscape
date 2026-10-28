"""PFFDTD grid planning (API/worker side, numpy only): spacing, alignment, cost.

The grid's cell faces start at the scene bounding-box minimum (PFFDTD CartGrid with a
3.5-cell offset). Choosing h so the bounding-box extents are whole numbers of cells also
puts the maximum planes on cell faces, so axis-aligned walls are represented exactly
(A3: 2nd order). Oblique walls are staircased and converge only at first order.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from config.constants import (
    PFFDTD_ALIGN_SEARCH_FRACTION,
    PFFDTD_BYTES_PER_NODE,
    PFFDTD_COURANT_CART,
    PFFDTD_GPU_MEMORY_GB,
    PFFDTD_GPU_MEMORY_USABLE_FRACTION,
    PFFDTD_GRID_PADDING_CELLS,
    PFFDTD_NODE_UPDATES_PER_S,
    PFFDTD_OBLIQUE_WALL_TOLERANCE_DEG,
    PFFDTD_SPEED_OF_SOUND,
)


@dataclass
class GridPlan:
    h: float                      # grid spacing (m)
    h_target: float               # c / (fmax * ppw)
    ppw_effective: float          # PPW at fmax with the chosen h
    misalignment_cells: list      # per axis: distance of extent/h to the nearest integer
    shape: tuple                  # (Nx, Ny, Nz) incl. halo
    nodes: int
    steps: int
    gpu_bytes: int
    gpu_budget_bytes: int
    est_runtime_s: float          # per source
    domain_extents: Optional[list] = None  # padded domain (open scenes); None = geometry bbox

    @property
    def fits_gpu(self) -> bool:
        return self.gpu_bytes <= self.gpu_budget_bytes

    def as_dict(self) -> dict:
        return {
            "h": self.h,
            "h_target": self.h_target,
            "ppw_effective": self.ppw_effective,
            "misalignment_cells": self.misalignment_cells,
            "grid_shape": list(self.shape),
            "nodes": self.nodes,
            "steps": self.steps,
            "gpu_memory_gb": self.gpu_bytes / 1e9,
            "gpu_budget_gb": self.gpu_budget_bytes / 1e9,
            "est_runtime_s_per_source": self.est_runtime_s,
            "domain_extents": self.domain_extents,
        }


def _misalignment(extents: np.ndarray, h: float) -> np.ndarray:
    r = extents / h
    return np.abs(r - np.round(r))


def aligned_spacing(extents, h_target: float) -> tuple[float, list]:
    """Largest h <= h_target (within PFFDTD_ALIGN_SEARCH_FRACTION) that best puts every
    bounding-box extent on a whole number of cells. Returns (h, misalignment per axis)."""
    extents = np.asarray(extents, np.float64)
    h_min = h_target * (1.0 - PFFDTD_ALIGN_SEARCH_FRACTION)
    candidates = [h_target]
    for L in extents:
        if L <= 0:
            continue
        for n in range(math.ceil(L / h_target), math.floor(L / h_min) + 1):
            candidates.append(L / n)
    best = min(candidates, key=lambda h: (round(float(_misalignment(extents, h).sum()), 9), -h))
    return best, _misalignment(extents, best).tolist()


def plan_grid(extents, fmax: float, ppw: float, duration: float, domain_extents=None,
              h: Optional[float] = None) -> GridPlan:
    """Grid spacing aligned to the geometry ``extents``; cost from ``domain_extents`` if given.

    ``domain_extents`` is a padded simulation domain (open scenes: the source/receivers are
    outside the geometry). ``h`` stays aligned to the geometry so its faces sit on cell faces;
    padded bounds must then be whole cells away from the geometry bbox. An explicit ``h`` skips
    the alignment search (callers that planned the grid themselves, e.g. a padded domain whose
    ground plane spans the domain).
    """
    extents = np.asarray(extents, np.float64)
    h_target = PFFDTD_SPEED_OF_SOUND / (fmax * ppw)
    if h is None:
        h, mis = aligned_spacing(extents, h_target)
    else:
        h = float(h)
        mis = _misalignment(extents, h).tolist()
    sized = extents if domain_extents is None else np.asarray(domain_extents, np.float64)
    shape = tuple(int(math.ceil(L / h)) + PFFDTD_GRID_PADDING_CELLS for L in sized)
    nodes = int(np.prod(shape))
    Ts = h * PFFDTD_COURANT_CART / PFFDTD_SPEED_OF_SOUND
    steps = int(math.ceil(duration / Ts))
    return GridPlan(
        h=h,
        h_target=h_target,
        ppw_effective=PFFDTD_SPEED_OF_SOUND / (fmax * h),
        misalignment_cells=mis,
        shape=shape,
        nodes=nodes,
        steps=steps,
        gpu_bytes=nodes * PFFDTD_BYTES_PER_NODE,
        gpu_budget_bytes=int(PFFDTD_GPU_MEMORY_GB * 1e9 * PFFDTD_GPU_MEMORY_USABLE_FRACTION),
        est_runtime_s=nodes * steps / PFFDTD_NODE_UPDATES_PER_S,
        domain_extents=None if domain_extents is None else sized.tolist(),
    )


def oblique_area_fraction(normals: np.ndarray, areas: np.ndarray) -> float:
    """Share of surface area whose normal is not within tolerance of a grid axis."""
    if len(areas) == 0:
        return 0.0
    n = np.abs(np.asarray(normals, np.float64))
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    aligned = n.max(axis=1) >= math.cos(math.radians(PFFDTD_OBLIQUE_WALL_TOLERANCE_DEG))
    areas = np.asarray(areas, np.float64)
    return float(areas[~aligned].sum() / max(areas.sum(), 1e-12))
