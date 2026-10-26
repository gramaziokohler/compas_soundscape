"""IRs of a free-positioning run, composed from raw sim-rate signals (shared by the pipeline's
pair IRs and ir_server.py, so a re-derived IR is exactly what a run would have written).

Raw store (``<free_dir>``):
    free.json          mode, Ts, Nt, c, offset_m, n_probe, runs, post-processing parameters
    run_<k>.npy        float32 [Np, n_probe, Nt] node signals of run k (outputs.stream_node_receivers)
    free_points.bin    float32 [Np, 3] point positions, then uint8 [Np] valid (1 = reached by sound)

Modes:
- ``listener`` (forward): run k = fixed source k. A point's IR is its pressure (n_probe 1) or
  the pressure-gradient FOA channels of its 7 probes (postprocess.foa_channels).
- ``source`` (reciprocal): runs per fixed listener -- a monopole at the listener ("W") and, for
  an FOA listener, a +/- monopole pair one probe offset either side along each axis
  ("X"/"Y"/"Z"). By reciprocity, a point's signal in the W run is the listener's pressure for an
  omni source at the point; in an axis run, c * integral(.) / (2 offset) is the listener's
  first-order SN3D channel (same as the forward probes, foa_channels). Sources are omni here;
  ``directional`` composes a first-order source pattern from 7-probe points.
"""

from __future__ import annotations

import numpy as np

from pffdtd_backend.postprocess import foa_channels, to_ir

FREE_META = "free.json"
FREE_POINTS = "free_points.bin"
AXES = ("X", "Y", "Z")
DIPOLE_DIRS = {"X": (1.0, 0.0, 0.0), "Y": (0.0, 1.0, 0.0), "Z": (0.0, 0.0, 1.0)}


def run_file(k: int) -> str:
    return f"run_{k}.npy"


def dipole_points(listener, axis: str, offset_m: float) -> list:
    """Source points of a reciprocal axis run: +1 at L + offset * axis, -1 at L - offset * axis."""
    d = offset_m * np.asarray(DIPOLE_DIRS[axis])
    L = np.asarray(listener, np.float64)
    return [((L + d).tolist(), 1.0), ((L - d).tolist(), -1.0)]


def dipole_channel(sig: np.ndarray, Ts: float, offset_m: float, c: float) -> np.ndarray:
    """Recorded response of a +/- pair run -> the listener's first-order channel (u_axis * p)."""
    return c * Ts * np.cumsum(np.asarray(sig, np.float64), axis=-1) / (2.0 * offset_m)


def forward_channels(probes: np.ndarray, Ts: float, offset_m: float, c: float, foa: bool) -> np.ndarray:
    """[n_probe, Nt] -> [1, Nt] (pressure) or [4, Nt] ACN [W, Y, Z, X]."""
    probes = np.asarray(probes, np.float64)
    return foa_channels(probes, Ts, offset_m, c) if foa else probes[:1]


def reciprocal_channels(w: np.ndarray, axes: dict | None, Ts: float, offset_m: float, c: float) -> np.ndarray:
    """Listener channels for an omni source at a point: w [Nt] (W run), axes {X|Y|Z: [Nt]} (FOA)."""
    w = np.asarray(w, np.float64)
    if not axes:
        return w[None, :]
    x, y, z = (dipole_channel(axes[a], Ts, offset_m, c) for a in AXES)
    return np.vstack([w, y, z, x])


def directional(w: np.ndarray, xyz: np.ndarray, a: float, n) -> np.ndarray:
    """First-order source pattern a + (1 - a) cos(theta) about unit vector n.

    w: the omni signal; xyz [3, Nt]: u_x p, u_y p, u_z p at the source point, u pointing toward
    the listener (foa_channels of 7 reciprocal probes, reordered to x, y, z)."""
    n = np.asarray(n, np.float64)
    n = n / np.linalg.norm(n)
    return a * np.asarray(w) + (1.0 - a) * (n @ np.asarray(xyz))


def to_wav_ir(channels: np.ndarray, Ts: float, post: dict) -> np.ndarray:
    """[C, Nt] sim rate -> [C, N] at post["out_fs"], band-limited, re the free field at 1 m."""
    ir = to_ir(
        channels, Ts, fmax=post["fmax"], out_fs=post["out_fs"], duration=post["duration"],
        lowcut_hz=post["lowcut_hz"], lowcut_order=post["lowcut_order"], lowpass_order=post["lowpass_order"],
        air_absorption=post["air_absorption"], Tc=post["Tc"], rh=post["rh"],
    )
    return ir * float(post["gain"])
