# backend/tests/test_pffdtd_preflight.py
"""PFFDTD grid planning and preflight checks (no GPU / compas-pffdtd env needed)."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from models.schemas import MeshPrepSettings  # noqa: E402
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService  # noqa: E402
from services.simulation_preflight_service import (  # noqa: E402
    ENGINE_PFFDTD,
    PreflightContext,
    SeedMeta,
    SimulationPreflightService,
)
from utils.pffdtd_grid import aligned_spacing, oblique_area_fraction, plan_grid  # noqa: E402

MAT = {"coeffs": [0.2] * 6, "center_freqs": [125, 250, 500, 1000, 2000, 4000]}


def _box(dims, rotation=None):
    Lx, Ly, Lz = dims
    v = np.array([[0, 0, 0], [Lx, 0, 0], [Lx, Ly, 0], [0, Ly, 0], [0, 0, Lz], [Lx, 0, Lz], [Lx, Ly, Lz], [0, Ly, Lz]], float)
    if rotation is not None:
        c = v.mean(axis=0)
        v = (v - c) @ rotation.T + c
    quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    f = [t for a, b, c_, d in quads for t in ([a, b, c_], [a, c_, d])]
    return v.tolist(), f


def _analyze(dims, seeds, fmax=500.0, ppw=20.0, rotation=None):
    v, f = _box(dims, rotation)
    mesh = SimulationMeshService.prepare(
        v, f, {"room": [0, len(f) - 1]}, {i: MAT for i in range(len(f))}, None,
        [s["position"] for s in seeds],
        MeshPrepOptions.from_settings(MeshPrepSettings().model_copy(update={"merge_coplanar": False})),
    )
    ctx = PreflightContext(
        engine=ENGINE_PFFDTD, seeds=[SeedMeta(**s) for s in seeds], pairs=[("s", "r")],
        pffdtd_fmax=fmax, pffdtd_ppw=ppw, pffdtd_duration=1.0,
    )
    return {i.code: i for i in SimulationPreflightService.analyze(mesh, ctx).issues}


SEEDS = [{"id": "s", "kind": "source", "position": [1.0, 1.0, 1.0]},
         {"id": "r", "kind": "receiver", "position": [2.2, 1.6, 1.2]}]


def test_aligned_spacing_puts_walls_on_cell_faces():
    h, mis = aligned_spacing([3.2, 2.5, 2.1], 0.0343)
    assert h <= 0.0343 and max(mis) < 1e-9
    assert abs(h - 1 / 30) < 1e-12


def test_plan_grid_cost_and_ppw():
    plan = plan_grid([3.2, 2.5, 2.1], 500.0, 20.0, 1.0)
    assert plan.ppw_effective >= 20.0 and plan.fits_gpu
    big = plan_grid([40.0, 30.0, 15.0], 4000.0, 40.0, 1.0)
    assert not big.fits_gpu


def test_oblique_fraction():
    n = np.array([[1, 0, 0], [0, 0, 1], [np.sqrt(0.5), np.sqrt(0.5), 0]])
    assert abs(oblique_area_fraction(n, np.array([1.0, 1.0, 2.0])) - 0.5) < 1e-9


def test_preflight_shoebox_ok():
    issues = _analyze([3.2, 2.5, 2.1], SEEDS)
    assert "pffdtd_grid" in issues and "pffdtd_band_limited" in issues
    assert "pffdtd_oblique_walls" not in issues
    assert not [i for i in issues.values() if i.severity == "error"]


def test_preflight_flags_clearance_size_and_staircasing():
    near = [SEEDS[0], {"id": "r", "kind": "receiver", "position": [2.2, 1.6, 0.06]}]
    issues = _analyze([3.2, 2.5, 2.1], near)
    assert issues["pffdtd_seed_clearance"].severity == "error"
    big = _analyze([3.2, 2.5, 2.1], SEEDS, fmax=4000.0, ppw=80.0)
    assert big["pffdtd_grid_too_large"].severity == "error"
    az = np.deg2rad(30)
    rot = np.array([[np.cos(az), -np.sin(az), 0], [np.sin(az), np.cos(az), 0], [0, 0, 1]])
    centred = [{**s, "position": list(np.subtract(s["position"], [1.6, 1.25, 1.05]) @ rot.T + [1.6, 1.25, 1.05])} for s in SEEDS]
    rotated = _analyze([3.2, 2.5, 2.1], centred, rotation=rot)
    assert "pffdtd_oblique_walls" in rotated
