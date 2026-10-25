"""Turn raw PFFDTD receiver signals into band-limited IRs at the backend sample rate.

Convention: the output sequence's DTFT equals the transfer function for a unit-sample
source, so the direct path has |H| = 1/(4 pi r) -- the same scale as pyroomacoustics IRs
(A1 point-source test, within 0.05 dB on the Cartesian grid).
"""

from __future__ import annotations

import numpy as np
import resampy
from scipy.signal import butter, sosfilt, sosfiltfilt

import pffdtd_backend  # noqa: F401  (puts upstream python/ on sys.path)
from air_abs.visco_filter import apply_visco_filter

FOA_PROBE_OFFSETS = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], np.float64)


def probe_positions(receiver: np.ndarray, foa: bool, offset_m: float) -> np.ndarray:
    """Grid probes for one receiver: [centre] (mono) or [centre, +x, -x, +y, -y, +z, -z] (FOA)."""
    receiver = np.asarray(receiver, np.float64)
    if not foa:
        return receiver[None, :]
    return np.vstack([receiver, receiver + offset_m * FOA_PROBE_OFFSETS])


def foa_channels(probes: np.ndarray, Ts: float, offset_m: float, c: float) -> np.ndarray:
    """ACN/SN3D first-order channels [W, Y, Z, X] from 7 pressure probes [7, Nt].

    For a plane wave from direction u, c * integral(dp/dx) dt = u_x p, i.e. the SN3D
    first-order component. Gradients are central differences across 2*offset.
    """
    w = probes[0]
    grads = [(probes[1 + 2 * a] - probes[2 + 2 * a]) / (2 * offset_m) for a in range(3)]
    x, y, z = (c * Ts * np.cumsum(g) for g in grads)
    return np.vstack([w, y, z, x])


def to_ir(
    signals: np.ndarray,
    Ts: float,
    fmax: float,
    out_fs: float,
    duration: float,
    lowcut_hz: float,
    lowcut_order: int,
    lowpass_order: int,
    air_absorption: bool,
    Tc: float,
    rh: float,
) -> np.ndarray:
    """[C, Nt] at 1/Ts -> [C, round(duration*out_fs)] at out_fs, band-limited to fmax."""
    fs = 1.0 / Ts
    # the uniform-pressure mode never decays (admittances vanish at 0 Hz): low-cut it
    x = sosfilt(butter(lowcut_order, lowcut_hz, btype="high", fs=fs, output="sos"), signals, axis=-1)
    # resampling keeps the continuous waveform; rescale to keep the unit-sample convention
    y = resampy.resample(x, fs, out_fs, axis=-1, filter="kaiser_best") * (fs / out_fs)
    y = sosfiltfilt(butter(lowpass_order, fmax, btype="low", fs=out_fs, output="sos"), y, axis=-1)
    if air_absorption:
        y = np.atleast_2d(apply_visco_filter(y, out_fs, Tc=Tc, rh=rh))
    n = int(round(duration * out_fs))
    out = np.zeros((y.shape[0], n))
    m = min(n, y.shape[-1])
    out[:, :m] = y[:, :m]
    return out
