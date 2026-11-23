# backend/utils/loudness.py
"""Loudness calibration shared by every audio input.

`calibrate_loudness` is the single post-processing step that puts a sound file
on the app's level anchor: measure its perceived loudness (ITU-R BS.1770 gated
integrated loudness), apply the gain that brings it to the target, then catch
any overs with a true-peak limiter instead of turning the whole file down.

Why gated loudness instead of RMS: K-weighting follows how loud a sound is
perceived (hiss and crowds count more, rumble less), and the gates skip silence
and quiet tails, so a sparse event is measured on its active part. It is one
vectorized pass (block energies from a cumulative sum), with no segment search.

numpy + scipy only (no torch / librosa), so every worker env, including the
isolated Stable Audio 3 env, can import it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import lfilter, resample_poly

from config.constants import (
    DEFAULT_DBFS,
    K_WEIGHT_HIGHPASS_HZ,
    K_WEIGHT_HIGHPASS_Q,
    K_WEIGHT_SHELF_GAIN_DB,
    K_WEIGHT_SHELF_HZ,
    K_WEIGHT_SHELF_Q,
    K_WEIGHT_SHELF_VB_EXPONENT,
    LIMITER_WINDOW_MS,
    LOUDNESS_ABSOLUTE_GATE_LUFS,
    LOUDNESS_BLOCK_OVERLAP,
    LOUDNESS_BLOCK_S,
    LOUDNESS_MAX_GAIN_DB,
    LOUDNESS_RELATIVE_GATE_LU,
    TARGET_LOUDNESS_LUFS,
    TRUE_PEAK_CEILING_DBTP,
    TRUE_PEAK_CHUNK_PAD,
    TRUE_PEAK_CHUNK_SAMPLES,
    TRUE_PEAK_OVERSAMPLE,
)

_LUFS_OFFSET = -0.691  # BS.1770: loudness = -0.691 + 10 log10(mean square of the K-weighted signal)


@dataclass(frozen=True)
class LoudnessReport:
    """What `calibrate_loudness` measured and did (for logs / diagnostics)."""

    measured_lufs: float | None  # None = silent (below the absolute gate), left untouched
    target_lufs: float
    gain_db: float
    true_peak_dbtp: float  # after calibration (the ceiling when the limiter acted)
    limiter_reduction_db: float  # deepest gain reduction the limiter applied (0 = untouched)

    def describe(self) -> str:
        if self.measured_lufs is None:
            return "silent, left untouched"
        return (
            f"{self.measured_lufs:.1f} LUFS -> {self.target_lufs:.1f} LUFS "
            f"(gain {self.gain_db:+.1f} dB, limiter {self.limiter_reduction_db:.1f} dB, "
            f"true peak {self.true_peak_dbtp:.1f} dBTP)"
        )


# ─── Measurement ──────────────────────────────────────────────────────────────

# Bilinear designs after B. De Man, "Evaluation of implementations of the EBU R128
# loudness measurement" (AES 2018): at 48 kHz they reproduce the BS.1770 coefficients,
# and they stay correct at any other rate (uploads keep their native rate).

def _biquad_high_shelf(sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    k = np.tan(np.pi * K_WEIGHT_SHELF_HZ / sample_rate)
    vh = 10.0 ** (K_WEIGHT_SHELF_GAIN_DB / 20.0)
    vb = vh ** K_WEIGHT_SHELF_VB_EXPONENT
    q = K_WEIGHT_SHELF_Q
    a0 = 1.0 + k / q + k * k
    b = np.array([vh + vb * k / q + k * k, 2.0 * (k * k - vh), vh - vb * k / q + k * k]) / a0
    a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    return b, a


def _biquad_high_pass(sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    k = np.tan(np.pi * K_WEIGHT_HIGHPASS_HZ / sample_rate)
    q = K_WEIGHT_HIGHPASS_Q
    a0 = 1.0 + k / q + k * k
    b = np.array([1.0, -2.0, 1.0])
    a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    return b, a


def _k_weight(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    b, a = _biquad_high_shelf(sample_rate)
    shelved = lfilter(b, a, audio)
    b, a = _biquad_high_pass(sample_rate)
    return lfilter(b, a, shelved)


def _power_to_lufs(power: np.ndarray | float) -> np.ndarray | float:
    return _LUFS_OFFSET + 10.0 * np.log10(np.maximum(power, 1e-20))


def measure_loudness_lufs(audio: np.ndarray, sample_rate: int) -> float | None:
    """Gated integrated loudness (ITU-R BS.1770) of a mono signal.

    Returns None when the signal is entirely below the absolute gate (silence).
    A clip shorter than one gating block is measured as a single block.
    """
    x = np.asarray(audio, dtype=np.float64).reshape(-1)
    if x.size == 0:
        return None

    weighted_sq = _k_weight(x, sample_rate) ** 2
    block = max(1, int(round(LOUDNESS_BLOCK_S * sample_rate)))
    if x.size <= block:
        block_power = np.array([weighted_sq.mean()])
    else:
        hop = max(1, int(round(block * (1.0 - LOUDNESS_BLOCK_OVERLAP))))
        starts = np.arange(0, x.size - block + 1, hop)
        cumulative = np.concatenate(([0.0], np.cumsum(weighted_sq)))
        block_power = (cumulative[starts + block] - cumulative[starts]) / block

    block_lufs = _power_to_lufs(block_power)
    above_absolute = block_power[block_lufs > LOUDNESS_ABSOLUTE_GATE_LUFS]
    if above_absolute.size == 0:
        return None

    relative_gate = _power_to_lufs(above_absolute.mean()) + LOUDNESS_RELATIVE_GATE_LU
    gated = above_absolute[_power_to_lufs(above_absolute) > relative_gate]
    return float(_power_to_lufs(gated.mean()))


def true_peak_envelope(audio: np.ndarray) -> np.ndarray:
    """Per-sample true peak: max |x| over the oversampled points of each sample.

    Oversampled in chunks (with context on each side) so a long upload does not
    allocate a full-length oversampled copy.
    """
    x = np.asarray(audio, dtype=np.float64).reshape(-1)
    factor = TRUE_PEAK_OVERSAMPLE
    envelope = np.empty_like(x)
    for start in range(0, x.size, TRUE_PEAK_CHUNK_SAMPLES):
        stop = min(x.size, start + TRUE_PEAK_CHUNK_SAMPLES)
        lo = max(0, start - TRUE_PEAK_CHUNK_PAD)
        hi = min(x.size, stop + TRUE_PEAK_CHUNK_PAD)
        up = np.abs(resample_poly(x[lo:hi], factor, 1))
        up = up[(start - lo) * factor:(stop - lo) * factor]
        envelope[start:stop] = np.maximum(up.reshape(-1, factor).max(axis=1), np.abs(x[start:stop]))
    return envelope


def _amplitude_to_db(value: float) -> float:
    return float(20.0 * np.log10(max(value, 1e-12)))


# ─── Processing ───────────────────────────────────────────────────────────────

def limit_true_peak(
    audio: np.ndarray, sample_rate: int, ceiling_dbtp: float = TRUE_PEAK_CEILING_DBTP,
) -> tuple[np.ndarray, float, float]:
    """Look-ahead true-peak limiter.

    Returns (limited audio, deepest reduction in dB, true peak in dBTP after limiting;
    the ceiling when the limiter acted).

    The required gain (ceiling / true peak, capped at 1) is held with a minimum
    filter and smoothed with a box filter of the same centred window, so the
    applied gain is never above the required gain at any sample (each box
    average only spans minima that include that sample) and ramps over
    LIMITER_WINDOW_MS instead of jumping. Untouched below the ceiling.
    """
    x = np.asarray(audio, dtype=np.float64).reshape(-1)
    ceiling = 10.0 ** (ceiling_dbtp / 20.0)
    peaks = true_peak_envelope(x)
    max_peak = float(peaks.max()) if peaks.size else 0.0
    if max_peak <= ceiling:
        return x, 0.0, _amplitude_to_db(max_peak)

    required = np.minimum(1.0, ceiling / np.maximum(peaks, 1e-12))
    window = max(1, int(round(LIMITER_WINDOW_MS * 1e-3 * sample_rate))) | 1  # odd → centred
    held = minimum_filter1d(required, size=window, mode="nearest")
    gain = np.minimum(uniform_filter1d(held, size=window, mode="nearest"), required)
    return x * gain, -_amplitude_to_db(float(gain.min())), ceiling_dbtp


def calibrate_loudness(
    audio: np.ndarray,
    sample_rate: int,
    target_dbfs: float = DEFAULT_DBFS,
    base_dbfs: float = DEFAULT_DBFS,
    limit: bool = True,
) -> tuple[np.ndarray, LoudnessReport]:
    """Normalize a mono signal to the loudness anchor, then true-peak limit it.

    The target loudness is TARGET_LOUDNESS_LUFS shifted by (target_dbfs - base_dbfs):
    calibrating to the global base anchor gives exactly TARGET_LOUDNESS_LUFS, and
    every per-sound level is a pure dB offset from it.

    Args:
        audio: Mono samples, shape (samples,) or (1, samples).
        sample_rate: Sample rate of `audio`.
        target_dbfs: Level the file is calibrated to (normally the global base anchor).
        base_dbfs: The level that maps to TARGET_LOUDNESS_LUFS.
        limit: False skips the limiter (intermediate step before further processing).

    Returns:
        (calibrated float32 samples with the input's shape, report)
    """
    original_shape = np.shape(audio)
    x = np.asarray(audio, dtype=np.float64).reshape(-1)
    target_lufs = TARGET_LOUDNESS_LUFS + (target_dbfs - base_dbfs)

    measured = measure_loudness_lufs(x, sample_rate)
    if measured is None:
        peak = _amplitude_to_db(float(np.abs(x).max())) if x.size else -240.0
        return x.astype(np.float32).reshape(original_shape), LoudnessReport(None, target_lufs, 0.0, peak, 0.0)

    gain_db = min(target_lufs - measured, LOUDNESS_MAX_GAIN_DB)
    y = x * 10.0 ** (gain_db / 20.0)
    reduction_db = 0.0
    if limit:
        y, reduction_db, true_peak = limit_true_peak(y, sample_rate)
        # Last-resort guard against inter-sample residue: the file format clips at 1.0.
        y = np.clip(y, -1.0, 1.0)
    else:
        true_peak = _amplitude_to_db(float(np.abs(y).max()))  # sample peak (no oversampling)
    report = LoudnessReport(measured, target_lufs, gain_db, true_peak, reduction_db)
    return y.astype(np.float32).reshape(original_shape), report
