"""High-order source directivity in reciprocal PFFDTD runs (numpy + scipy; both environments).

Benchmark feature, off in the app (``PFFDTD_HIGH_ORDER_DIRECTIVITY_ENV``). The first-order path
(directional.py) records 7 probes at a source. Here a directional source records the pressure on
every grid node of a ball of ``radius_cells`` around it. The field there comes from outside the
ball (by reciprocity, from the listener), so per frequency it is a regular expansion

    p(x, f) = sum_lm 4 pi i^l j_l(k |x|) Y_lm(x^) B_lm(f),

whose plane-wave density ``B(u)`` is indexed by the direction ``u`` from the source toward where
each wave comes from (numpy's FFT kernel e^{-i w t}: a plane wave arriving from ``u`` is
e^{+i k u.x}). A source radiating ``D(u, f)`` toward ``u`` then gives the listener

    S(f) = integral B(u) D(u) du = sum_lm B_lm(f) D_lm(f),

with real orthonormal spherical harmonics (``real_sh``). An omnidirectional ``D = 1`` returns the
centre probe exactly; ``D = a + (1 - a) n.u`` matches directional.compose for a plane wave.

``B_lm`` is fitted per frequency by least squares up to the order the ball resolves at that
frequency: order ``l`` is kept while ``max |j_l(k r)| >= bessel_floor`` over the probes (at least
order 1, at most ``max_order``). ``D_lm`` (world frame, per frequency) is projected from the
measured balloon on the API side (services/pffdtd_directivity.py).
"""

from __future__ import annotations

import math

import numpy as np
from scipy.special import lpmv, spherical_jn


def n_coeffs(order: int) -> int:
    return (int(order) + 1) ** 2


def real_sh(order: int, dirs: np.ndarray) -> np.ndarray:
    """Real orthonormal spherical harmonics ``[n, (order+1)^2]`` (ACN index l^2 + l + m) of unit
    vectors ``dirs [n, 3]`` (z up; azimuth from +x toward +y). The integral of Y^2 over the sphere is 1."""
    d = np.atleast_2d(np.asarray(dirs, np.float64))
    norm = np.linalg.norm(d, axis=1)
    d = d / np.where(norm > 0, norm, 1.0)[:, None]
    cos_t = np.clip(d[:, 2], -1.0, 1.0)
    phi = np.arctan2(d[:, 1], d[:, 0])
    out = np.zeros((d.shape[0], n_coeffs(order)))
    for l in range(order + 1):
        for m in range(0, l + 1):
            k = math.sqrt((2 * l + 1) / (4 * math.pi) * math.factorial(l - m) / math.factorial(l + m))
            p = k * lpmv(m, l, cos_t)
            if m == 0:
                out[:, l * l + l] = p
            else:
                out[:, l * l + l + m] = math.sqrt(2.0) * p * np.cos(m * phi)
                out[:, l * l + l - m] = math.sqrt(2.0) * p * np.sin(m * phi)
    return out


def ball_offsets(radius_cells: float) -> np.ndarray:
    """Integer grid offsets ``[n, 3]`` with |o| <= radius_cells; the centre first."""
    r = int(math.floor(radius_cells))
    g = np.arange(-r, r + 1)
    o = np.stack(np.meshgrid(g, g, g, indexing="ij"), axis=-1).reshape(-1, 3)
    o = o[np.einsum("ij,ij->i", o, o) <= radius_cells ** 2 + 1e-9]
    o = o[np.argsort(np.einsum("ij,ij->i", o, o), kind="stable")]
    return o.astype(np.float64)


def probe_positions(source: np.ndarray, h: float, radius_cells: float) -> np.ndarray:
    return np.asarray(source, np.float64)[None, :] + h * ball_offsets(radius_cells)


def order_at(k: float, radii: np.ndarray, max_order: int, bessel_floor: float) -> int:
    """Highest order the probe ball resolves at wavenumber k (at least 1)."""
    kr = k * float(np.max(radii))
    n = 1
    for l in range(2, max_order + 1):
        if abs(spherical_jn(l, kr)) < bessel_floor:
            break
        n = l
    return min(n, max_order)


def fit_field(spectra: np.ndarray, offsets_m: np.ndarray, freqs_hz: np.ndarray, c: float,
              max_order: int, bessel_floor: float) -> tuple[np.ndarray, np.ndarray]:
    """``B_lm(f) [n_f, (max_order+1)^2]`` (zeros above each frequency's order) and the order per bin.

    spectra: ``[n_probe, n_f]`` complex probe spectra (numpy rfft); offsets_m: ``[n_probe, 3]``.
    """
    r = np.linalg.norm(offsets_m, axis=1)
    Y = real_sh(max_order, np.where(r[:, None] > 0, offsets_m, [0.0, 0.0, 1.0]))
    ls = np.concatenate([[l] * (2 * l + 1) for l in range(max_order + 1)])
    out = np.zeros((len(freqs_hz), n_coeffs(max_order)), complex)
    orders = np.zeros(len(freqs_hz), int)
    for fi, f in enumerate(freqs_hz):
        k = 2.0 * math.pi * float(f) / c
        n = order_at(k, r, max_order, bessel_floor) if k > 0 else 0
        nc = n_coeffs(n)
        jl = np.stack([spherical_jn(l, k * r) for l in range(n + 1)], axis=1)   # [n_probe, n+1]
        M = 4.0 * math.pi * (1j ** ls[:nc])[None, :] * jl[:, ls[:nc]] * Y[:, :nc]
        out[fi, :nc] = np.linalg.lstsq(M, spectra[:, fi], rcond=None)[0]
        orders[fi] = n
    return out, orders


def interp_coeffs(spec: dict, freqs_hz: np.ndarray, n: int) -> np.ndarray:
    """``D_lm`` of the spec at ``freqs_hz`` (linear in frequency, held at the ends) -> ``[n_f, n]``."""
    f0 = np.asarray(spec["freqs_hz"], np.float64)
    D = np.asarray(spec["coeffs"], np.float64)            # [n_f0, (order_D+1)^2]
    out = np.zeros((len(freqs_hz), n))
    for j in range(min(n, D.shape[1])):
        out[:, j] = np.interp(freqs_hz, f0, D[:, j])
    return out


def compose_ho(probes: np.ndarray, offsets_m: np.ndarray, spec: dict, fs: float, c: float) -> np.ndarray:
    """Listener signal of a directional source from its ball probes ``[n_probe, Nt]``.

    spec: ``{"coeffs": [n_f0][(N+1)^2] world-frame D_lm, "freqs_hz": [n_f0], "max_order",
    "bessel_floor", ...}``. Bins above ``spec["f_top_hz"]`` (if given; the IR is low-passed at
    fmax afterwards) are left at zero.
    """
    probes = np.asarray(probes, np.float64)
    n_t = probes.shape[1]
    X = np.fft.rfft(probes, axis=-1)
    freqs = np.fft.rfftfreq(n_t, 1.0 / fs)
    max_order = int(spec["max_order"])
    top = float(spec.get("f_top_hz") or freqs[-1])
    keep = freqs <= top
    B, _ = fit_field(X[:, keep], offsets_m, freqs[keep], c, max_order, float(spec["bessel_floor"]))
    D = interp_coeffs(spec, freqs[keep], n_coeffs(max_order))
    S = np.zeros(freqs.size, complex)
    S[keep] = np.sum(B * D, axis=1)
    return np.fft.irfft(S, n=n_t)
