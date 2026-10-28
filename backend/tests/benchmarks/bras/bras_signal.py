"""DSP primitives of the BRAS comparison: same band-limiting as the solver, gates, spectra, bands."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt, sosfiltfilt

from benchmarks.bras.bras_constants import NFFT
from config.constants import PFFDTD_LOWCUT_HZ, PFFDTD_LOWCUT_ORDER, PFFDTD_LOWPASS_ORDER
from utils.resampling import resample_to

_EPS = 1e-30


def bandlimit_like_sim(ir: np.ndarray, fs: float, fmax: float) -> np.ndarray:
    """The solver's post-processing filters (pffdtd_backend/postprocess.py ``to_ir``):
    causal 10 Hz high-pass, then a zero-phase Butterworth low-pass at fmax."""
    x = sosfilt(butter(PFFDTD_LOWCUT_ORDER, PFFDTD_LOWCUT_HZ, btype="high", fs=fs, output="sos"), ir)
    return sosfiltfilt(butter(PFFDTD_LOWPASS_ORDER, fmax, btype="low", fs=fs, output="sos"), x)


def resample_ir(ir: np.ndarray, fs_in: float, fs_out: float) -> np.ndarray:
    """Polyphase resampling keeping the unit-sample convention (DTFT magnitude = transfer function)."""
    return resample_to(np.asarray(ir, np.float64), fs_in, int(fs_out)) * (fs_in / fs_out)


def half_hann_window(n: int, fs: float, t0: float, t1: float, fade_in: float, fade_out: float) -> np.ndarray:
    """1 on [t0, t1], half-Hann fades of ``fade_in`` before t0 and ``fade_out`` after t1, 0 elsewhere."""
    t = np.arange(n) / fs
    w = np.zeros(n)
    w[(t >= t0) & (t <= t1)] = 1.0
    if fade_in > 0:
        sel = (t >= t0 - fade_in) & (t < t0)
        w[sel] = 0.5 - 0.5 * np.cos(np.pi * (t[sel] - (t0 - fade_in)) / fade_in)
    if fade_out > 0:
        sel = (t > t1) & (t <= t1 + fade_out)
        w[sel] = 0.5 + 0.5 * np.cos(np.pi * (t[sel] - t1) / fade_out)
    return w


def gate(ir: np.ndarray, fs: float, t0: float, t1: float, fade_in: float, fade_out: float) -> np.ndarray:
    return np.asarray(ir, np.float64) * half_hann_window(len(ir), fs, t0, t1, fade_in, fade_out)


def spectrum(x: np.ndarray, fs: float, nfft: int = NFFT) -> tuple[np.ndarray, np.ndarray]:
    """Frequencies and complex DFT (zero-padded to ``nfft``)."""
    n = max(nfft, len(x))
    return np.fft.rfftfreq(n, 1.0 / fs), np.fft.rfft(np.asarray(x, np.float64), n)


def smooth_db(f: np.ndarray, H: np.ndarray, fraction: int, f_out: np.ndarray) -> np.ndarray:
    """Power average of |H|^2 over +-1/(2 fraction) octave around each ``f_out`` -> dB."""
    p = np.abs(H) ** 2
    cs = np.concatenate([[0.0], np.cumsum(p)])
    half = 2.0 ** (1.0 / (2.0 * fraction))
    lo = np.searchsorted(f, f_out / half, side="left")
    hi = np.maximum(np.searchsorted(f, f_out * half, side="right"), lo + 1)
    return 10.0 * np.log10(np.maximum((cs[hi] - cs[lo]) / (hi - lo), _EPS))


def band_levels_db(f: np.ndarray, H: np.ndarray, centres, bands_per_octave: int) -> np.ndarray:
    """Mean |H|^2 in fractional-octave bands (edges fc * 2^(+-1/(2 n))) -> dB."""
    half = 2.0 ** (1.0 / (2.0 * bands_per_octave))
    p = np.abs(H) ** 2
    out = []
    for fc in centres:
        sel = (f >= fc / half) & (f < fc * half)
        out.append(10.0 * np.log10(max(float(p[sel].mean()) if sel.any() else 0.0, _EPS)))
    return np.asarray(out)


def band_energy_db(f: np.ndarray, H: np.ndarray, fmin: float, fmax: float) -> float:
    sel = (f >= fmin) & (f <= fmax)
    return float(10.0 * np.log10(max(float((np.abs(H[sel]) ** 2).mean()), _EPS)))


def xcorr_lag_s(a: np.ndarray, b: np.ndarray, fs: float, max_lag_s: float) -> float:
    """Delay of ``b`` relative to ``a`` (s), parabolic-interpolated cross-correlation peak."""
    n = len(a) + len(b)
    nfft = 1 << (n - 1).bit_length()
    c = np.fft.irfft(np.conj(np.fft.rfft(a, nfft)) * np.fft.rfft(b, nfft), nfft)
    m = int(round(max_lag_s * fs))
    lags = np.r_[np.arange(0, m + 1), np.arange(-m, 0)]
    vals = np.r_[c[: m + 1], c[-m:]]
    k = int(np.argmax(vals))
    lag = float(lags[k])
    prev, nxt = vals[k - 1] if k > 0 else vals[k], vals[(k + 1) % len(vals)]
    denom = prev - 2 * vals[k] + nxt
    if abs(denom) > 1e-30 and lags[k] != m and lags[k] != -m:
        lag += 0.5 * (prev - nxt) / denom
    return lag / fs


def fractional_shift(x: np.ndarray, shift_s: float, fs: float) -> np.ndarray:
    """Delay ``x`` by ``shift_s`` (may be negative / fractional), linear phase in the DFT domain."""
    n = len(x)
    nfft = 1 << (2 * n - 1).bit_length()
    f = np.fft.rfftfreq(nfft, 1.0 / fs)
    X = np.fft.rfft(np.asarray(x, np.float64), nfft) * np.exp(-2j * np.pi * f * shift_s)
    return np.fft.irfft(X, nfft)[:n]
