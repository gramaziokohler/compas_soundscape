"""First-order source directivity in reciprocal PFFDTD runs (numpy only; runs in compas-pffdtd).

A directional source S is a 7-probe receiver set in a run that emits from the listener L.
``postprocess.foa_channels`` turns the probes into ``w`` (pressure) and ``xyz`` (u·p, u pointing
from S toward L); by reciprocity the listener's signal for a first-order source pattern
``g·[a + (1 − a)·(n·u)]`` is ``g·[a·w + (1 − a)·(n·xyz)]`` (free_ir.directional, validated in
validation/test_c1_reciprocity.py).

Measured balloons arrive as one such pattern per octave band (``a_k, gain_k, axis_world_k``,
fitted at import by services/directivity_processing.py). ``compose`` combines the bands in the
frequency domain with weights that sum to 1 at every frequency (triangular in log-frequency
between adjacent band centres, flat outside), so an omni fit reproduces ``w`` exactly and a
single band equals the time-domain formula.
"""

from __future__ import annotations

import numpy as np


def band_weights(freqs_hz: np.ndarray, centers_hz) -> np.ndarray:
    """``(n_bands, n_freqs)`` weights; every column sums to 1.

    Band k is 1 at its centre and falls linearly in log-frequency to 0 at the neighbouring
    centres; the first / last band stay 1 below / above their centre.
    """
    centers = np.asarray(centers_hz, dtype=np.float64)
    f = np.asarray(freqs_hz, dtype=np.float64)
    n = centers.size
    if n <= 1:
        return np.ones((max(n, 1), f.size))
    x = np.log2(np.maximum(f, 1e-9))
    c = np.log2(centers)
    out = np.zeros((n, f.size))
    for k in range(n):
        if k == 0:
            out[k] = np.interp(x, [c[0], c[1]], [1.0, 0.0])
        elif k == n - 1:
            out[k] = np.interp(x, [c[k - 1], c[k]], [0.0, 1.0])
        else:
            out[k] = np.interp(x, [c[k - 1], c[k], c[k + 1]], [0.0, 1.0, 0.0], left=0.0, right=0.0)
    return out


def compose(w: np.ndarray, xyz: np.ndarray, spec: dict, fs: float) -> np.ndarray:
    """Listener signal of a directional source from its reciprocal probe channels.

    w: [Nt] pressure at the source point; xyz: [3, Nt] (x, y, z) gradient channels (u·p);
    spec: ``{"a": [..], "gain": [..], "axis_world": [[x, y, z], ..], "bands_hz": [..]}`` with
    one entry per band (a single entry = frequency-independent pattern); fs: 1 / Ts.
    """
    a = np.asarray(spec["a"], dtype=np.float64).ravel()
    g = np.asarray(spec["gain"], dtype=np.float64).ravel()
    axes = np.asarray(spec["axis_world"], dtype=np.float64).reshape(-1, 3)
    w = np.asarray(w, dtype=np.float64)
    xyz = np.asarray(xyz, dtype=np.float64)
    if a.size == 1:
        return g[0] * (a[0] * w + (1.0 - a[0]) * (axes[0] @ xyz))
    n_t = w.size
    spectrum_w = np.fft.rfft(w)
    spectrum_xyz = np.fft.rfft(xyz, axis=-1)
    weights = band_weights(np.fft.rfftfreq(n_t, 1.0 / fs), spec["bands_hz"])
    out = np.zeros_like(spectrum_w)
    for k in range(a.size):
        out += weights[k] * g[k] * (a[k] * spectrum_w + (1.0 - a[k]) * (axes[k] @ spectrum_xyz))
    return np.fft.irfft(out, n=n_t)


def probe_row_ranges(directional: list, n_probe_directional: int = 7) -> list[tuple[int, int]]:
    """``(first_row, n_rows)`` of each source's probes in a run's receiver list."""
    ranges: list[tuple[int, int]] = []
    start = 0
    for flag in directional:
        n = n_probe_directional if flag else 1
        ranges.append((start, n))
        start += n
    return ranges
