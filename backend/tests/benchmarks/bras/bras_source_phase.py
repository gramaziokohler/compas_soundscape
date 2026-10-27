"""The loudspeaker's phase for the simulated IRs (phase-only filter from its on-axis IR).

PFFDTD composes the measured directivity as per-band magnitudes on a zero-phase pulse, so a
simulated IR has no loudspeaker phase; the measured IRs carry it (crossover phase rotation,
low-frequency group delay). The filter is ``exp(j angle H_onaxis)`` with the on-axis IR's bulk
delay (its main peak) removed: |H| is unchanged and the simulated direct sound keeps its arrival
time. The phase does not vary with direction.

The on-axis IR is the first line (direction P000T000) of a BRAS ``*_IR_front_pole.csv``.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

from benchmarks.bras import bras_constants as K
from config.constants import DIRECTIVITY_BRAS_FS


@dataclass
class SourcePhase:
    fir: np.ndarray       # all-pass FIR, main lobe at ``pre`` samples
    fs: float
    pre: int
    peak_index: int       # main peak of the source IR the phase came from


def read_onaxis_ir(csv_path: Path | str) -> np.ndarray:
    """First line of the BRAS ``*_IR_front_pole.csv`` = direction P000T000 (on-axis), 44.1 kHz."""
    with open(csv_path, "r", encoding="utf-8", errors="replace") as fh:
        label, _, rest = fh.readline().strip().partition(",")
    if label != "P000T000":
        raise ValueError(f"{csv_path}: first direction is {label!r}, expected the on-axis P000T000")
    return np.asarray([float(v) for v in rest.split(",") if v.strip()], np.float64)


def phase_fir(ir: np.ndarray, fs: float, nfft: int = K.SOURCE_PHASE_NFFT, pre_s: float = K.SOURCE_PHASE_PRE_S,
              floor_db: float = K.SOURCE_PHASE_FLOOR_DB) -> SourcePhase:
    """All-pass FIR with the phase of ``ir``; its bulk delay (main peak) is moved to ``pre_s``."""
    ir = np.asarray(ir, np.float64)
    peak = int(np.argmax(np.abs(ir)))
    pre = int(round(pre_s * fs))
    H = np.fft.rfft(ir, nfft)
    mag = np.abs(H)
    unit = np.where(mag > mag.max() * 10.0 ** (floor_db / 20.0), H / np.maximum(mag, 1e-300), 1.0)
    k = np.arange(unit.size)
    unit = unit * np.exp(2j * np.pi * k * (peak - pre) / nfft)   # advance by the bulk delay
    return SourcePhase(np.fft.irfft(unit, nfft), float(fs), pre, peak)


def cache_path(csv_path: Path | str) -> Path:
    return K.CACHE_DIR / f"{Path(csv_path).stem}_onaxis_phase.npz"


def load_or_build(csv_path: Path | str, force: bool = False) -> SourcePhase:
    """Cached phase filter of a BRAS directivity file's on-axis IR (one CSV line; the cache is tiny)."""
    path = cache_path(csv_path)
    if path.exists() and not force:
        with np.load(path) as d:
            return SourcePhase(d["fir"], float(d["fs"]), int(d["pre"]), int(d["peak_index"]))
    sp = phase_fir(read_onaxis_ir(csv_path), DIRECTIVITY_BRAS_FS)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, fir=sp.fir, fs=sp.fs, pre=sp.pre, peak_index=sp.peak_index)
    return sp


def apply(ir: np.ndarray, fs: float, phase: SourcePhase) -> np.ndarray:
    """``ir`` filtered by the loudspeaker phase, same length and timing (the filter's ``pre`` removed)."""
    if abs(fs - phase.fs) > 1e-6:
        raise ValueError(f"IR at {fs} Hz, phase filter at {phase.fs} Hz: resample first")
    x = np.asarray(ir, np.float64)
    return fftconvolve(x, phase.fir)[phase.pre: phase.pre + x.size]
