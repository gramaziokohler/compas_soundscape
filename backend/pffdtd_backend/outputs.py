"""Read PFFDTD engine outputs: receiver signals (trilinear-recombined) and field snapshots."""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
from scipy.signal import lfilter

from pffdtd_backend.sim_prepare import PreparedSim, unfold_fcc_field


def read_receivers(gpu_dir: Path) -> tuple[np.ndarray, float]:
    """Return (r_out [Nr, Nt], Ts): pressure at each receiver at the native sim rate.

    Receivers are recombined from their 8 trilinear-interpolation nodes. If the source
    was differentiated (``diff``), the exact inverse (trapezoidal integrator) is applied,
    with no low-cut, so the result is the raw scheme response.
    """
    gpu_dir = Path(gpu_dir)
    with h5py.File(gpu_dir / "comms_out.h5", "r") as f:
        out_alpha = f["out_alpha"][...]
        diff = bool(f["diff"][()])
    with h5py.File(gpu_dir / "sim_consts.h5", "r") as f:
        Ts = float(f["Ts"][()])
    with h5py.File(gpu_dir / "sim_outs.h5", "r") as f:
        u_out = f["u_out"][...]
    r_out = np.sum((u_out * out_alpha.ravel()[:, None]).reshape((*out_alpha.shape, -1)), axis=1)
    if diff:
        r_out = lfilter(Ts / 2 * np.array([1.0, 1.0]), np.array([1.0, -1.0]), r_out, axis=-1)
    return r_out, Ts


def read_snapshots(prep: PreparedSim) -> list[tuple[int, np.ndarray]]:
    """Return [(n, u^n on the full Cartesian grid)], NaN at non-FCC nodes for FCC runs."""
    Nx, Ny, Nz = prep.shape
    out = []
    with h5py.File(prep.gpu_dir / "snap_out.h5", "r") as f:
        k = 0
        while f"u_snap_{k:03d}" in f:
            n = int(f[f"n_snap_{k:03d}"][()])
            u = f[f"u_snap_{k:03d}"][...]
            if prep.fcc:
                u = unfold_fcc_field(u.reshape((Nx, Ny // 2 + 1, Nz)), Ny)
            else:
                u = u.reshape((Nx, Ny, Nz))
            out.append((n, u))
            k += 1
    return out
