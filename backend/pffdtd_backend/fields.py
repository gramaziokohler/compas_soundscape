"""Field outputs on the output plane: total-SPL (strength G) map and wave-animation frames.

Strength G: the engine accumulates sum_n y[n]^2 per plane node, y = the pressure band-passed
by ``band_sos`` (the IR chain: low-cut at the uniform-mode cut-off, low-pass at fmax). With the
unit-sample source convention a free-field point at distance r has |H| = 1/(4 pi r) in band,
so by Parseval its sum is (1/(4 pi r))^2 * sum h_bp^2 (h_bp = impulse response of the same
filter at the sim rate). G = 10 log10(sum y^2 / that sum at r = ref_m): 0 dB in free field at
ref_m (ISO 3382 strength uses 10 m). Air absorption is not applied to the map.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt

ANIM_VMAX_PERCENTILE = 99.5
ANIM_VMAX_SKIP_FRACTION = 0.1   # the source region dominates the first frames
INT8_MAX = 127
PULSE_PERIODS_PER_FMAX = 1.5    # one sine cycle of period 1.5 / fmax: in band, zero net volume


def band_sos(fs: float, fmax: float, lowcut_hz: float, lowcut_order: int, lowpass_order: int) -> np.ndarray:
    """[S, 6] SOS cascade (high-pass lowcut, then low-pass fmax with twice the IR's one-way order,
    matching the magnitude of its forward-backward low-pass)."""
    hp = butter(lowcut_order, lowcut_hz, btype="high", fs=fs, output="sos")
    lp = butter(2 * lowpass_order, fmax, btype="low", fs=fs, output="sos")
    return np.vstack([hp, lp])


def reference_energy(sos: np.ndarray, ref_m: float, n: int) -> float:
    """Band-passed sum of p^2 of a unit-sample source in free field at ref_m."""
    x = np.zeros(n)
    x[0] = 1.0
    h = sosfilt(sos, x)
    return float(np.sum(h * h)) / (4.0 * np.pi * ref_m) ** 2


def strength_g(p2: np.ndarray, sos: np.ndarray, ref_m: float, n: int) -> np.ndarray:
    """dB re free field at ref_m; NaN where nothing arrived (p2 <= 0)."""
    ref = reference_energy(sos, ref_m, n)
    with np.errstate(divide="ignore", invalid="ignore"):
        g = 10.0 * np.log10(np.asarray(p2, np.float64) / ref)
    g[~np.isfinite(g)] = np.nan
    return g


def pulse(fmax: float):
    """Source signal (Ts, Nt) -> [Nt]: one sine cycle of period PULSE_PERIODS_PER_FMAX / fmax."""
    period = PULSE_PERIODS_PER_FMAX / fmax

    def signal(Ts: float, Nt: int) -> np.ndarray:
        t = np.arange(Nt) * Ts
        return np.where(t < period, np.sin(2 * np.pi * t / period), 0.0)

    return signal


def quantize_frames(frames: np.ndarray) -> tuple[np.ndarray, float]:
    """[F, Np] float -> (int8 [F, Np], vmax) with value = q / 127 * vmax (symmetric, clipped)."""
    frames = np.nan_to_num(np.asarray(frames, np.float64))
    tail = np.abs(frames[int(len(frames) * ANIM_VMAX_SKIP_FRACTION):])
    vmax = float(np.percentile(tail, ANIM_VMAX_PERCENTILE)) if tail.size else 0.0
    if vmax <= 0.0:
        vmax = float(np.abs(frames).max()) or 1.0
    q = np.clip(np.round(frames / vmax * INT8_MAX), -INT8_MAX, INT8_MAX).astype(np.int8)
    return q, vmax


def snapshot_steps(nt: int, frames: int) -> np.ndarray:
    stride = max(1, nt // max(1, frames))
    return np.arange(0, nt, stride, dtype=np.int64)[:frames]
