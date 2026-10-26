"""Compiled drop-in for upstream ``air_abs.visco_filter.apply_visco_filter``.

Same filter and arithmetic (a Gaussian kernel per input sample whose width grows with time,
Hamilton DAFx2021), but the per-sample loop runs in numba instead of Python: ~0.5 s -> a few
ms for a 1 s IR at 48 kHz, which is what makes free-positioning IRs interactive.
validation/test_c1_reciprocity.py checks it against the upstream function.
"""

from __future__ import annotations

import numba as nb
import numpy as np

import pffdtd_backend  # noqa: F401  (puts upstream python/ on sys.path)
from air_abs.get_air_absorption import get_air_absorption

DEFAULT_NDB = 120  # kernel truncation, as upstream


@nb.njit(cache=True)
def _scatter(x, y, n_start, Ts, Tsg2, Tsg2pi, dt_fac):
    C, Nt0 = x.shape
    for n in range(n_start, Nt0):
        dt_int = int(np.ceil(np.sqrt(dt_fac * n) / Ts))
        a = Ts / np.sqrt(n * Tsg2pi)
        den = n * Tsg2
        for m in range(n - dt_int, n + dt_int + 1):
            e = np.exp(-(((n - m) * Ts) ** 2) / den)
            for ch in range(C):
                y[ch, m] += a * x[ch, n] * e


def apply_visco_filter(x: np.ndarray, Fs: float, Tc: float, rh: float, NdB: float = DEFAULT_NDB) -> np.ndarray:
    """[C, N] (or [N]) -> [C, N + tail] (squeezed like upstream)."""
    rd = get_air_absorption(1, Tc, rh)
    g = rd["gamma_p"]
    Ts = 1 / Fs
    t_start = Ts**2 / (2 * np.pi * g)
    x = np.ascontiguousarray(np.atleast_2d(x), dtype=np.float64)
    Nt0 = x.shape[-1]
    dt_end = Fs * np.sqrt(0.1 * np.log(10) * NdB * (Nt0 - 1) * Ts * g)
    Nt = Nt0 + int(np.ceil(dt_end))
    y = np.zeros((x.shape[0], Nt))
    n_start = int(np.ceil(t_start * Fs))
    assert n_start > 0
    y[:, :n_start] = x[:, :n_start]
    _scatter(x, y, n_start, Ts, 2 * Ts * g, 2 * Ts * g * np.pi, 0.1 * np.log(10) * NdB * g * Ts)
    return np.squeeze(y)
