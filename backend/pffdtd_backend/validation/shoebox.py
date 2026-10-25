"""Shared A3/A4 machinery: rigid shoebox IR vs exact image-source reference."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np

from pffdtd_backend.engine import run_engine
from pffdtd_backend.outputs import read_receivers
from pffdtd_backend.sim_prepare import SimSpec, prepare
from pffdtd_backend.validation.metrics import (
    complex_error_db,
    dtft,
    half_hann_fade,
    level_diff_db,
    third_octave_diffs_db,
    zero_phase_band,
)
from pffdtd_backend.validation.references import ism_impulse_response
from pffdtd_backend.validation.scenes import box_scene

DIMS = (3.2, 2.5, 2.1)
SOURCE = (0.90, 0.70, 1.10)
RECEIVERS = [(2.35, 1.80, 1.30), (1.60, 1.25, 0.60), (2.90, 0.40, 1.75)]
C_SOUND = 343.2
IR_LENGTH = 0.150  # s, compared window
SIM_MARGIN = 0.030  # s simulated beyond the window (filter edge effects)
FADE = 0.005  # s, half-Hann fade at the end of the window (identical for both)
FMAX = 500.0
BAND = (63.0, 400.0)
SPLIT = float(np.sqrt(BAND[0] * BAND[1]))  # half-band split (~159 Hz)
REF_FS = 192000.0
DF = 0.25  # Hz, DTFT evaluation grid
RESULT_FILE = "result.json"

# acceptance (user criteria)
CPLX_ERR_MAX_DB = -20.0
TOB_MEAN_MAX_DB = 0.5
TOB_MAX_MAX_DB = 1.6
LEVEL_MAX_DB = 0.1


def ppw_at_fmax(h: float) -> float:
    return C_SOUND / (FMAX * h)


def remove_uniform_mode(x: np.ndarray, fs: float) -> np.ndarray:
    """Subtract the rigid-room uniform-pressure mode.

    For a unit-sample source the zero mode of a rigid room is a ramp (c^2 t / V per unit
    time, exact in the modal expansion that the ISM sum equals). It is removed with a
    least-squares a + b t fit over the whole signal, identically for simulation and
    reference (the oscillating modes are zero-mean over the ~8+ periods of the window).
    """
    x = np.atleast_2d(x)
    t = np.arange(x.shape[-1]) / fs
    A = np.c_[np.ones_like(t), t]
    coef, *_ = np.linalg.lstsq(A, x.T, rcond=None)
    return x - (A @ coef).T


def _process(x: np.ndarray, fs: float) -> np.ndarray:
    """Same processing for simulation and reference: drop the uniform mode, low-pass at
    fmax (zero phase, short memory), then window to IR_LENGTH with a short fade."""
    y = zero_phase_band(remove_uniform_mode(x, fs), fs, 0.0, FMAX)
    n = int(round(IR_LENGTH * fs))
    return y[..., :n] * half_hann_fade(n, int(round(FADE * fs)))


def reference_tf(f: np.ndarray) -> np.ndarray:
    """Processed ISM transfer functions [Nr, Nf], in the box frame (also used for A4)."""
    H = []
    for rcv in RECEIVERS:
        h_ref = ism_impulse_response(DIMS, SOURCE, rcv, IR_LENGTH + SIM_MARGIN, C_SOUND, REF_FS)
        H.append(dtft(_process(h_ref, REF_FS), REF_FS, f)[0])
    return np.array(H)


def compare(f: np.ndarray, H: np.ndarray, Href: np.ndarray) -> dict:
    lo = f < SPLIT
    hi = ~lo
    tob = third_octave_diffs_db(f, H, Href, BAND[0], BAND[1])
    tob_abs = np.abs(np.array(list(tob.values())))
    res = {
        "cplx_err_low_db": complex_error_db(H[lo], Href[lo]),
        "cplx_err_high_db": complex_error_db(H[hi], Href[hi]),
        "tob_mean_abs_db": float(tob_abs.mean()),
        "tob_max_abs_db": float(tob_abs.max()),
        "level_db": level_diff_db(H, Href),
        "third_octaves": tob,
    }
    res["pass"] = (
        res["cplx_err_low_db"] <= CPLX_ERR_MAX_DB
        and res["cplx_err_high_db"] <= CPLX_ERR_MAX_DB
        and res["tob_mean_abs_db"] <= TOB_MEAN_MAX_DB
        and res["tob_max_abs_db"] <= TOB_MAX_MAX_DB
        and abs(res["level_db"]) <= LEVEL_MAX_DB
    )
    return res


def run_shoebox(
    work_dir: Path,
    h: float,
    fcc: bool,
    precision: str = "double",
    rotation: Optional[np.ndarray] = None,
    tag: str = "a3",
    Href: Optional[np.ndarray] = None,
) -> dict:
    f = np.arange(BAND[0], BAND[1] + DF / 2, DF)
    sim_dir = work_dir / f"{tag}_{'fcc' if fcc else 'cart'}_{precision}_ppw{ppw_at_fmax(h):.1f}"
    cached = sim_dir / RESULT_FILE
    if cached.exists():  # same scene and grid already evaluated in this work dir
        return json.loads(cached.read_text())
    scene = box_scene(DIMS, [SOURCE], RECEIVERS, rotation=rotation)
    spec = SimSpec(
        sim_dir=sim_dir,
        scene=scene,
        duration=IR_LENGTH + SIM_MARGIN,
        h=h,
        fcc=fcc,
        precision=precision,
    )
    prep = prepare(spec)
    runtime = run_engine(prep.gpu_dir, precision)
    r_out, Ts = read_receivers(prep.gpu_dir)
    H = dtft(_process(r_out, 1 / Ts), 1 / Ts, f)
    if Href is None:
        Href = reference_tf(f)
    per_rcv = [compare(f, H[i], Href[i]) for i in range(len(RECEIVERS))]
    result = {
        "grid": "fcc" if fcc else "cart",
        "precision": precision,
        "h": h,
        "ppw_at_500hz": ppw_at_fmax(h),
        "points": int(np.prod(prep.shape)),
        "steps": prep.Nt,
        "runtime_s": runtime,
        "receivers": per_rcv,
        "worst_cplx_err_db": max(max(r["cplx_err_low_db"], r["cplx_err_high_db"]) for r in per_rcv),
        "pass": all(r["pass"] for r in per_rcv),
    }
    cached.write_text(json.dumps(result))
    return result
