"""A2: rigid unit cube, Gaussian initial condition, field L-inf error at t = 0.01 s.

Paper sec. 5.1.1 (Melander et al. 2023). The paper does not state the Gaussian centre;
the cube centre (0.5, 0.5, 0.5) is used here. FDTD-adapted acceptance: the fitted
h-convergence rate of the field error is -2 +/- 0.3 (2nd-order scheme), for the
Cartesian and FCC grids, at the maximum Courant number and at 0.02x (the C_CFL = 0.02
analogue). Walls are grid-aligned (cell faces), so the rate is not polluted by staircasing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from pffdtd_backend.engine import run_engine
from pffdtd_backend.outputs import read_snapshots
from pffdtd_backend.sim_prepare import SimSpec, prepare, snap_courant
from pffdtd_backend.validation.metrics import fit_rate
from pffdtd_backend.validation.references import CubeModalGaussian
from pffdtd_backend.validation.scenes import box_scene

S_XYZ = 0.3  # m^2, spatial variance (eq. 26)
CENTRE = (0.5, 0.5, 0.5)
T_EVAL = 0.01  # s
C_SOUND = 343.2  # PFFDTD c at Tc = 20 degC
INV_H_FULL = [10, 20, 40, 80, 160]
INV_H_QUICK = [10, 20, 40]
COURANT_FACTORS = [1.0, 0.02]
RATE_TARGET = -2.0
RATE_TOL = 0.3


def run_case(work_dir: Path, inv_h: int, fcc: bool, courant_factor: float) -> dict:
    h = 1.0 / inv_h
    l, n = snap_courant(h, C_SOUND, T_EVAL, fcc, courant_factor)
    model = CubeModalGaussian([1, 1, 1], CENTRE, S_XYZ, C_SOUND)
    tag = f"a2_{'fcc' if fcc else 'cart'}_cf{courant_factor:g}_h{inv_h}"
    spec = SimSpec(
        sim_dir=work_dir / tag,
        scene=box_scene([1, 1, 1], [CENTRE], [CENTRE]),
        duration=n * h * l / C_SOUND,
        h=h,
        fcc=fcc,
        courant=l,
        silent_source=True,
        initial_condition=model.pointwise,
        ic_mask=lambda X, Y, Z: (X > 0) & (X < 1) & (Y > 0) & (Y < 1) & (Z > 0) & (Z < 1),
        snapshot_steps=[n],
    )
    prep = prepare(spec)
    assert abs(prep.c - C_SOUND) < 1e-9
    runtime = run_engine(prep.gpu_dir, "double")
    (n_snap, u), = read_snapshots(prep)
    assert n_snap == n
    t = n * prep.Ts
    ref = model.field(prep.xv, prep.yv, prep.zv, t)
    inside = (
        ((prep.xv > 0) & (prep.xv < 1))[:, None, None]
        & ((prep.yv > 0) & (prep.yv < 1))[None, :, None]
        & ((prep.zv > 0) & (prep.zv < 1))[None, None, :]
    )
    err = np.abs(u - ref)[inside & np.isfinite(u)]
    return {
        "inv_h": inv_h,
        "grid": "fcc" if fcc else "cart",
        "courant_factor": courant_factor,
        "courant": l,
        "steps": n,
        "t": t,
        "linf_error": float(err.max()),
        "runtime_s": runtime,
        "points": int(np.prod(prep.shape)),
    }


def run(work_dir: Path, quick: bool = False) -> dict:
    inv_hs = INV_H_QUICK if quick else INV_H_FULL
    series = []
    for fcc in (False, True):
        for cf in COURANT_FACTORS:
            cases = [run_case(work_dir, k, fcc, cf) for k in inv_hs]
            rate = fit_rate([1 / c["inv_h"] for c in cases], [c["linf_error"] for c in cases])
            series.append(
                {
                    "grid": "fcc" if fcc else "cart",
                    "courant_factor": cf,
                    "cases": cases,
                    "rate": rate,
                    "pass": abs(rate - RATE_TARGET) <= RATE_TOL,
                }
            )
    return {
        "name": "A2 rigid unit cube h-convergence",
        "criteria": f"fitted rate {RATE_TARGET} +/- {RATE_TOL}",
        "series": series,
        "pass": all(s["pass"] for s in series),
    }


@pytest.mark.gpu
def test_a2_cube(work_dir, quick):
    result = run(work_dir, quick)
    for s in result["series"]:
        print(s["grid"], s["courant_factor"], s["rate"], [c["linf_error"] for c in s["cases"]])
    assert result["pass"], result
