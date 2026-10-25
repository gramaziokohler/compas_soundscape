"""Exact / analytic reference solutions for the validation suite."""

from __future__ import annotations

import numpy as np
from numpy.polynomial.legendre import leggauss

GAUSS_QUAD_POINTS = 400  # Gauss-Legendre nodes for 1D cosine-mode projections
MODE_TRUNCATION = 1e-16  # drop cosine modes with |a_m| below this (relative to max)


def gaussian_p0(r2: np.ndarray, s: float) -> np.ndarray:
    """Gaussian initial pressure p0 = exp(-r^2 / s) (paper eq. 26, s = spatial variance)."""
    return np.exp(-r2 / s)


def free_field_gaussian(R: np.ndarray, t: float, s: float, c: float) -> np.ndarray:
    """Exact spherically symmetric solution for a Gaussian initial pressure, zero velocity.

    p(R,t) = [(R-ct) p0(R-ct) + (R+ct) p0(R+ct)] / (2R), with the R -> 0 limit
    p(0,t) = p0(ct) + ct p0'(ct).
    """
    R = np.asarray(R, np.float64)
    a, b = R - c * t, R + c * t
    with np.errstate(divide="ignore", invalid="ignore"):
        p = (a * gaussian_p0(a * a, s) + b * gaussian_p0(b * b, s)) / (2.0 * R)
    ct = c * abs(t)
    p0_lim = gaussian_p0(ct * ct, s) * (1.0 - 2.0 * ct * ct / s)
    return np.where(R < 1e-12, p0_lim, p)


def point_source_free_field(R: float, c: float, f: np.ndarray) -> np.ndarray:
    """Free-field monopole transfer function e^{-jkR} / (4 pi R) (unit-sample source)."""
    return np.exp(-2j * np.pi * f * R / c) / (4 * np.pi * R)


class CubeModalGaussian:
    """Rigid box [0,Lx]x[0,Ly]x[0,Lz], Gaussian initial pressure, zero initial velocity.

    Exact solution as a cosine-mode expansion (Sakamoto 2007): each mode oscillates at
    omega_lmn = c pi sqrt((l/Lx)^2 + (m/Ly)^2 + (n/Lz)^2).

    images=True (default): the initial condition is the Gaussian plus all its wall images
    (method of images), i.e. the even 2L-periodic extension. It satisfies dp/dn = 0 at the
    walls and is smooth, and its cosine coefficients are closed-form:
    a_m = (2/L) sqrt(pi s) exp(-(m pi/L)^2 s/4) cos(m pi x0/L)  (a_0 halved).
    images=False: the single Gaussian restricted to the box, projected numerically. With
    s = 0.3 m^2 in a unit cube it is ~0.43 at the walls, so dp/dn != 0 there; the
    extension has a kink and the coefficients decay only as 1/m^2 (non-smooth problem).
    """

    def __init__(self, dims, centre, s: float, c: float, images: bool = True, max_modes: int = 200):
        self.dims = np.asarray(dims, np.float64)
        self.centre = np.asarray(centre, np.float64)
        self.s = s
        self.c = c
        self.images = images
        self.coeffs = [self._coeffs(L, x0, max_modes) for L, x0 in zip(self.dims, self.centre)]

    def _coeffs(self, L: float, x0: float, M: int) -> np.ndarray:
        m = np.arange(M)
        if self.images:
            k = m * np.pi / L
            a = (2.0 / L) * np.sqrt(np.pi * self.s) * np.exp(-k * k * self.s / 4) * np.cos(k * x0)
        else:
            xg, wg = leggauss(GAUSS_QUAD_POINTS)
            x = 0.5 * L * (xg + 1.0)
            w = 0.5 * L * wg
            g = np.exp(-((x - x0) ** 2) / self.s)
            a = (np.cos(np.outer(m, np.pi * x / L)) * g) @ w * (2.0 / L)
        a[0] *= 0.5
        keep = np.flatnonzero(np.abs(a) > MODE_TRUNCATION * np.abs(a).max())
        return a[: keep[-1] + 1]

    def field(self, xv: np.ndarray, yv: np.ndarray, zv: np.ndarray, t: float) -> np.ndarray:
        """p on the tensor grid xv x yv x zv at time t."""
        ax, ay, az = self.coeffs
        Lx, Ly, Lz = self.dims
        l, m, n = (np.arange(a.size) for a in (ax, ay, az))
        k2 = (l[:, None, None] / Lx) ** 2 + (m[None, :, None] / Ly) ** 2 + (n[None, None, :] / Lz) ** 2
        C = ax[:, None, None] * ay[None, :, None] * az[None, None, :] * np.cos(self.c * np.pi * np.sqrt(k2) * t)
        Px = np.cos(np.outer(l, np.pi * xv / Lx))
        Py = np.cos(np.outer(m, np.pi * yv / Ly))
        Pz = np.cos(np.outer(n, np.pi * zv / Lz))
        p = np.tensordot(Px, C, axes=(0, 0))  # (Nx, m, n)
        p = np.tensordot(p, Py, axes=(1, 0))  # (Nx, n, Ny)
        p = np.tensordot(p, Pz, axes=(1, 0))  # (Nx, Ny, Nz)
        return p

    def pointwise(self, X: np.ndarray, Y: np.ndarray, Z: np.ndarray, t: float) -> np.ndarray:
        """p at arbitrary (broadcastable) points; used for initial conditions on x-slabs."""
        xv, yv, zv = X[:, 0, 0], Y[0, :, 0], Z[0, 0, :]
        return self.field(xv, yv, zv, t)


def image_sources(dims, src, rcv, t_max: float, c: float) -> np.ndarray:
    """Distances of all rigid-box image sources (Allen & Berkley lattice) within c*t_max."""
    dims = np.asarray(dims, np.float64)
    src = np.asarray(src, np.float64)
    rcv = np.asarray(rcv, np.float64)
    rmax = c * t_max
    axes = []
    for L, s, r in zip(dims, src, rcv):
        nmax = int(np.ceil(rmax / (2 * L))) + 1
        n = np.arange(-nmax, nmax + 1)
        # image coordinates 2nL +/- s, measured from the receiver
        d = np.concatenate([2 * n * L + s - r, 2 * n * L - s - r])
        axes.append(d[np.abs(d) <= rmax])
    dx, dy, dz = np.meshgrid(*axes, indexing="ij", sparse=True)
    dist = np.sqrt(dx * dx + dy * dy + dz * dz).ravel()
    return dist[dist <= rmax]


def ism_impulse_response(dims, src, rcv, t_max: float, c: float, fs: float) -> np.ndarray:
    """Rigid-box ISM IR (unit-sample source convention, amplitude 1/(4 pi d) per image).

    Images are accumulated with linear fractional delay at sample rate fs; the sequence's
    DTFT approximates sum_i exp(-j w d_i/c) / (4 pi d_i), the same convention as the FDTD
    output for a unit-sample source.
    """
    dist = image_sources(dims, src, rcv, t_max, c)
    N = int(np.ceil(t_max * fs)) + 2
    pos = dist / c * fs
    i0 = np.floor(pos).astype(np.int64)
    frac = pos - i0
    amp = 1.0 / (4 * np.pi * dist)
    h = np.zeros(N + 1)
    np.add.at(h, i0, amp * (1 - frac))
    np.add.at(h, i0 + 1, amp * frac)
    return h[:N]


def ism_transfer_function(dims, src, rcv, t_max: float, c: float, f: np.ndarray) -> np.ndarray:
    """Exact DTFT-domain sum of the same (time-truncated) image set, for cross-checking."""
    dist = image_sources(dims, src, rcv, t_max, c)
    H = np.zeros(f.shape, np.complex128)
    for chunk in np.array_split(dist, max(1, dist.size // 4096)):
        H += (np.exp(-2j * np.pi * np.outer(f, chunk) / c) / (4 * np.pi * chunk)).sum(axis=1)
    return H
