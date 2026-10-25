"""A1: free-field Gaussian pulse and point source.

Setup: Gaussian initial pressure (eq. 26, s = 0.3 m^2) at the centre of a rigid 8 m cube;
receivers at R = 0.25..1.5 m along an axis, a face diagonal and a body diagonal. Each
receiver signal is time-gated before the first wall reflection can reach it (method of
images: a wall image at 2L contributes once ct > 2L - R - r_sig, where r_sig bounds the
pulse support at the 1e-8 level), so the result is free-field.

Reference: exact spherically symmetric solution (references.free_field_gaussian).
FDTD-adapted acceptance:
  - fitted h-rate of the relative L-inf error = -2 +/- 0.3 (Cartesian and FCC),
  - point-source variant: band level x 4 pi r within 0.1 dB of 1 over 63-400 Hz.
The PPW at which the relative error drops below 1e-2 and 1e-3 is reported.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from pffdtd_backend.engine import run_engine
from pffdtd_backend.outputs import read_receivers
from pffdtd_backend.sim_prepare import SimSpec, prepare
from pffdtd_backend.validation.metrics import dtft, fit_rate, half_hann_fade
from pffdtd_backend.validation.references import free_field_gaussian
from pffdtd_backend.validation.scenes import box_scene

S_XYZ = 0.3
HALF_WIDTH = 4.0  # m, cube [-4, 4]^3
SIG_RADIUS = np.sqrt(S_XYZ * np.log(1e8))  # pulse support at the 1e-8 level (~2.35 m)
RADII = [0.25, 0.5, 1.0, 1.5]
DIRECTIONS = np.array([[1, 0, 0], [1, 1, 0], [1, 1, 1]], np.float64)
INV_H_FULL = [10, 15, 20, 30, 40]
INV_H_QUICK = [10, 15, 20]
RATE_TARGET = -2.0
RATE_TOL = 0.3
C_SOUND = 343.2
FREF = 1000.0  # PPW is reported relative to this frequency (pulse content ~ below 1 kHz)

PS_RADII = [0.5, 1.0, 1.5]
PS_INV_H = [20, 30]  # accuracy is judged at the finest (PPW 64 at 400 Hz); coarser reported
PS_BAND = (63.0, 400.0)
PS_LEVEL_TOL_DB = 0.1
PS_FADE_S = 3e-3


def _receivers(radii) -> np.ndarray:
    dirs = DIRECTIONS / np.linalg.norm(DIRECTIONS, axis=1, keepdims=True)
    return np.array([r * d for r in radii for d in dirs])


def _scene(receivers: np.ndarray) -> dict:
    o = -HALF_WIDTH
    return box_scene([2 * HALF_WIDTH] * 3, [[1e-9, 1e-9, 1e-9]], receivers.tolist(), origin=(o, o, o))


def run_gaussian(work_dir: Path, inv_h: int, fcc: bool) -> dict:
    h = 1.0 / inv_h
    rcv = _receivers(RADII)
    R = np.linalg.norm(rcv, axis=1)
    gates = (2 * HALF_WIDTH - R - SIG_RADIUS) / C_SOUND
    assert np.all(gates * C_SOUND >= R + SIG_RADIUS), "domain too small for clean gating"
    spec = SimSpec(
        sim_dir=work_dir / f"a1_{'fcc' if fcc else 'cart'}_h{inv_h}",
        scene=_scene(rcv),
        duration=float(gates.max()),
        h=h,
        fcc=fcc,
        silent_source=True,
        initial_condition=lambda X, Y, Z, t: free_field_gaussian(np.sqrt(X * X + Y * Y + Z * Z), t, S_XYZ, C_SOUND),
    )
    prep = prepare(spec)
    runtime = run_engine(prep.gpu_dir, "double")
    r_out, Ts = read_receivers(prep.gpu_dir)
    t = np.arange(r_out.shape[1]) * Ts
    err = 0.0
    for i in range(rcv.shape[0]):
        sel = t <= gates[i]
        ref = free_field_gaussian(R[i], t[sel], S_XYZ, C_SOUND)
        err = max(err, float(np.max(np.abs(r_out[i, sel] - ref))))
    return {
        "inv_h": inv_h,
        "grid": "fcc" if fcc else "cart",
        "ppw_at_1khz": C_SOUND / (FREF * h),
        "rel_linf_error": err,  # p0 max = 1
        "runtime_s": runtime,
        "points": int(np.prod(prep.shape)),
    }


def run_point_source(work_dir: Path, fcc: bool, precision: str, inv_h: int) -> dict:
    h = 1.0 / inv_h
    rcv = _receivers(PS_RADII)
    R = np.linalg.norm(rcv, axis=1)
    gates = (2 * HALF_WIDTH - R) / C_SOUND - 1e-3
    spec = SimSpec(
        sim_dir=work_dir / f"a1ps_{'fcc' if fcc else 'cart'}_{precision}_h{inv_h}",
        scene=_scene(rcv),
        duration=float(gates.max()),
        h=h,
        fcc=fcc,
        precision=precision,
    )
    prep = prepare(spec)
    run_engine(prep.gpu_dir, precision)
    r_out, Ts = read_receivers(prep.gpu_dir)
    f = np.arange(PS_BAND[0], PS_BAND[1] + 1.0, 1.0)
    per_rcv = []
    for i in range(rcv.shape[0]):
        n = int(gates[i] / Ts)
        x = r_out[i, :n] * half_hann_fade(n, int(PS_FADE_S / Ts))
        H = dtft(x, 1 / Ts, f)[0] * 4 * np.pi * R[i]
        level = 10 * np.log10(np.mean(np.abs(H) ** 2))
        per_rcv.append({"R": float(R[i]), "level_db": float(level), "max_dev_db": float(np.max(np.abs(20 * np.log10(np.abs(H)))))})
    worst = max(abs(p["level_db"]) for p in per_rcv)
    return {
        "grid": "fcc" if fcc else "cart",
        "precision": precision,
        "inv_h": inv_h,
        "receivers": per_rcv,
        "worst_level_db": worst,
        "pass": worst <= PS_LEVEL_TOL_DB or inv_h != PS_INV_H[-1],
    }


def _ppw_below(cases: list, thr: float):
    ok = [c["ppw_at_1khz"] for c in cases if c["rel_linf_error"] < thr]
    return min(ok) if ok else None


def run(work_dir: Path, quick: bool = False) -> dict:
    inv_hs = INV_H_QUICK if quick else INV_H_FULL
    series = []
    for fcc in (False, True):
        cases = [run_gaussian(work_dir, k, fcc) for k in inv_hs]
        rate = fit_rate([1 / c["inv_h"] for c in cases], [c["rel_linf_error"] for c in cases])
        series.append(
            {
                "grid": "fcc" if fcc else "cart",
                "cases": cases,
                "rate": rate,
                "ppw_1khz_for_1e-2": _ppw_below(cases, 1e-2),
                "ppw_1khz_for_1e-3": _ppw_below(cases, 1e-3),
                "pass": abs(rate - RATE_TARGET) <= RATE_TOL,
            }
        )
    point = [
        run_point_source(work_dir, fcc, prec, k)
        for fcc in (False, True)
        for prec in ("double", "single")
        for k in PS_INV_H
    ]
    return {
        "name": "A1 free-field Gaussian + point source",
        "criteria": f"rate {RATE_TARGET} +/- {RATE_TOL}; point source level within {PS_LEVEL_TOL_DB} dB of 1/(4 pi r)",
        "series": series,
        "point_source": point,
        "pass": all(s["pass"] for s in series) and all(p["pass"] for p in point),
    }


@pytest.mark.gpu
def test_a1_free_field(work_dir, quick):
    result = run(work_dir, quick)
    for s in result["series"]:
        print(s["grid"], s["rate"], [c["rel_linf_error"] for c in s["cases"]])
    for p in result["point_source"]:
        print(p["grid"], p["precision"], p["inv_h"], p["worst_level_db"])
    assert result["pass"], result
