"""Error metrics shared by the validation tests."""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

THIRD_OCTAVE_CENTRES = 1000.0 * 2.0 ** (np.arange(-14, 1) / 3.0)  # nominal 40 Hz .. 1 kHz
DTFT_CHUNK = 2048


def dtft(x: np.ndarray, fs: float, f: np.ndarray) -> np.ndarray:
    """DTFT of real sequence(s) x[..., n] (sample rate fs) at frequencies f (Hz)."""
    x = np.atleast_2d(x)
    n = np.arange(x.shape[-1])
    X = np.zeros((x.shape[0], f.size), np.complex128)
    for i0 in range(0, n.size, DTFT_CHUNK):
        nn = n[i0 : i0 + DTFT_CHUNK]
        X += x[:, i0 : i0 + DTFT_CHUNK] @ np.exp(-2j * np.pi * np.outer(nn, f) / fs)
    return X


def complex_error_db(H: np.ndarray, Href: np.ndarray) -> float:
    """10 log10( sum |H - Href|^2 / sum |Href|^2 )."""
    return float(10 * np.log10(np.sum(np.abs(H - Href) ** 2) / np.sum(np.abs(Href) ** 2)))


def level_diff_db(H: np.ndarray, Href: np.ndarray) -> float:
    """Energy level difference 10 log10( sum |H|^2 / sum |Href|^2 )."""
    return float(10 * np.log10(np.sum(np.abs(H) ** 2) / np.sum(np.abs(Href) ** 2)))


def third_octave_diffs_db(f: np.ndarray, H: np.ndarray, Href: np.ndarray, fmin: float, fmax: float) -> dict:
    """Per third-octave band level differences for bands whose centre lies in [fmin, fmax]."""
    out = {}
    for fc in THIRD_OCTAVE_CENTRES:
        if fc < fmin * 0.999 or fc > fmax * 1.001:
            continue
        sel = (f >= fc * 2 ** (-1 / 6)) & (f < fc * 2 ** (1 / 6))
        if np.any(sel):
            out[round(float(fc), 1)] = level_diff_db(H[sel], Href[sel])
    return out


def zero_phase_band(x: np.ndarray, fs: float, f_hp: float, f_lp: float, order: int = 4) -> np.ndarray:
    """Identical zero-phase band-limiting applied to simulation and reference alike."""
    y = x
    if f_hp > 0:
        y = sosfiltfilt(butter(order, f_hp, btype="high", fs=fs, output="sos"), y, axis=-1)
    if f_lp > 0:
        y = sosfiltfilt(butter(order, f_lp, btype="low", fs=fs, output="sos"), y, axis=-1)
    return y


def fit_rate(h: np.ndarray, err: np.ndarray) -> float:
    """Least-squares slope of log(err) vs log(1/h) (Table 1 convention: negative = converging)."""
    h = np.asarray(h, np.float64)
    err = np.asarray(err, np.float64)
    return float(np.polyfit(np.log(1.0 / h), np.log(err), 1)[0])


def half_hann_fade(n_total: int, n_fade: int) -> np.ndarray:
    """Window that is 1 then fades to 0 over the last n_fade samples."""
    w = np.ones(n_total)
    if n_fade > 0:
        w[-n_fade:] = 0.5 * (1 + np.cos(np.pi * np.arange(1, n_fade + 1) / n_fade))
    return w
