"""Measured pairs (SOFA GeneralFIR), loudspeaker orientation and per-pair path geometry."""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import h5py
import numpy as np

from benchmarks.bras.bras_constants import ANALYSIS_FS, SOURCE_AIM_TOL_DEG
from benchmarks.bras.scenes import SourceInput
from utils.orientation import forward_vector


@dataclass
class MeasuredPair:
    source_id: str
    receiver_id: str
    source_position: np.ndarray
    receiver_position: np.ndarray
    ir: np.ndarray            # Pa, float64
    fs: float

    @property
    def key(self) -> str:
        return pair_key(self.source_id, self.receiver_id)


@dataclass
class PairGeometry:
    key: str
    source_id: str
    receiver_id: str
    d_direct: float
    t_direct: float           # at the chamber's speed of sound
    line_of_sight: bool       # direct path not blocked by the objects
    offaxis_direct_deg: Optional[float]  # loudspeaker axis vs direct path (None: omni / no orientation)


def pair_key(source_id: str, receiver_id: str) -> str:
    return f"{source_id}-{receiver_id}"


def speed_of_sound(temperature_c: float) -> float:
    return 331.3 * math.sqrt(1.0 + temperature_c / 273.15)


def _ids(ds, prefix: str) -> list[str]:
    return [f"{prefix}{int(round(float(v)))}" for v in np.asarray(ds).ravel()]


def _per_measurement(arr, m: int) -> np.ndarray:
    """SOFA positions as (M, 3): BRAS stores (1, 3, M); (M, 3, 1), (M, 3) and one (1, 3) position too."""
    a = np.asarray(arr, np.float64)
    if a.shape == (1, 3, m):
        return a[0].T
    if a.shape == (m, 3, 1):
        return a[:, :, 0]
    if a.shape == (m, 3):
        return a
    if a.size == 3:
        return np.tile(a.reshape(3), (m, 1))
    raise ValueError(f"Unexpected SOFA position shape {a.shape} for {m} measurements")


def load_sofa_pairs(path: Path | str) -> list[MeasuredPair]:
    """SOFA GeneralFIR (BRAS RS1-RS7): ``Data.IR`` (M, 1, N) in Pa, one loudspeaker-microphone pair each.

    Missing measurements (all-zero or non-finite IRs) are skipped.
    """
    with h5py.File(path, "r") as f:
        conv = f.attrs.get("SOFAConventions", b"")
        conv = conv.decode() if isinstance(conv, bytes) else str(conv)
        ir = np.asarray(f["Data.IR"], np.float64)
        if ir.ndim != 3:
            raise ValueError(f"{path}: {conv} with Data.IR {ir.shape}; the benchmark reads GeneralFIR (M, R, N) "
                             "files of the reference scenes (complex-room GeneralFIRE files are not supported)")
        fs = float(np.asarray(f["Data.SamplingRate"]).ravel()[0])
        m = ir.shape[0]
        src = _per_measurement(f["EmitterPosition"], m)
        rcv = _per_measurement(f["ReceiverPosition"], m)
        ls, mp = _ids(f["EmitterID"], "LS"), _ids(f["ReceiverID"], "MP")
    if abs(fs - ANALYSIS_FS) > 1e-6:
        raise ValueError(f"{path}: IRs at {fs} Hz; the analysis runs at {ANALYSIS_FS} Hz")
    pairs = []
    for i in range(m):
        x = ir[i, 0]
        if not np.all(np.isfinite(x)) or not np.any(x):
            continue
        pairs.append(MeasuredPair(ls[i], mp[i], src[i], rcv[i], x, fs))
    return pairs


def select_pairs(pairs: list[MeasuredPair], keys: Optional[list[str]]) -> list[MeasuredPair]:
    if not keys:
        return list(pairs)
    by_key = {p.key: p for p in pairs}
    missing = [k for k in keys if k not in by_key]
    if missing:
        raise KeyError(f"Unknown pairs {missing}; measured: {sorted(by_key)}")
    return [by_key[k] for k in keys]


def unique_sources(pairs: list[MeasuredPair]) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for p in pairs:
        out.setdefault(p.source_id, p.source_position)
    return out


# ── Orientation ───────────────────────────────────────────────────────────────

def bras_forward(phi_deg: float, theta_deg: float) -> np.ndarray:
    """BRAS label (phi from +x toward +y, theta up) -> unit vector."""
    p, t = math.radians(phi_deg), math.radians(theta_deg)
    return np.array([math.cos(t) * math.cos(p), math.cos(t) * math.sin(p), math.sin(t)])


def source_forward(source_id: str, position, src: SourceInput) -> Optional[np.ndarray]:
    """Unit vector the loudspeaker points along (labels first, else the aim point); None if unknown."""
    if source_id in src.orientations:
        return bras_forward(*src.orientations[source_id])
    if src.aim_point is not None:
        d = np.asarray(src.aim_point, np.float64) - np.asarray(position, np.float64)
        return d / np.linalg.norm(d)
    return None


def yaw_pitch_from_forward(forward) -> tuple[float, float]:
    """Inverse of ``utils.orientation.forward_vector`` (yaw 0 faces -Y, +yaw toward -X)."""
    f = np.asarray(forward, np.float64) / np.linalg.norm(forward)
    return math.atan2(-f[0], -f[1]), math.asin(float(np.clip(f[2], -1.0, 1.0)))


def check_orientations(sources: dict[str, np.ndarray], src: SourceInput) -> None:
    """Aim point vs labels when both are given; every loudspeaker needs one when directional."""
    for sid, pos in sources.items():
        if src.directivity is not None and source_forward(sid, pos, src) is None:
            raise ValueError(f"{sid}: no orientation (give SourceInput.orientations or aim_point)")
        if sid in src.orientations and src.aim_point is not None:
            a = np.asarray(src.aim_point, np.float64) - np.asarray(pos, np.float64)
            ang = math.degrees(math.acos(np.clip(np.dot(a / np.linalg.norm(a), bras_forward(*src.orientations[sid])), -1, 1)))
            if ang > SOURCE_AIM_TOL_DEG:
                raise AssertionError(f"{sid}: label {src.orientations[sid]} is {ang:.1f} deg off the aim point")
        f = source_forward(sid, pos, src)
        if f is not None:
            yaw, pitch = yaw_pitch_from_forward(f)
            if np.abs(forward_vector(yaw, pitch) - f).max() > 1e-9:
                raise AssertionError(f"{sid}: yaw/pitch round trip failed")


# ── Path geometry ─────────────────────────────────────────────────────────────

def segment_hits_mesh(a, b, vertices: np.ndarray, faces: np.ndarray, eps: float = 1e-9) -> bool:
    """Does the open segment a-b cross any triangle (Moller-Trumbore, vectorised)?"""
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    d = b - a
    tri = np.asarray(vertices, np.float64)[np.asarray(faces)]
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    p = np.cross(d, e2)
    det = np.einsum("ij,ij->i", e1, p)
    ok = np.abs(det) > eps
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = a - tri[:, 0]
    u = np.einsum("ij,ij->i", s, p) * inv
    q = np.cross(s, e1)
    v = (q @ d) * inv
    t = np.einsum("ij,ij->i", e2, q) * inv
    return bool(np.any(ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > eps) & (t < 1 - eps)))


def pair_geometry(pair: MeasuredPair, vertices, faces, src: SourceInput, c: float) -> PairGeometry:
    s, r = pair.source_position, pair.receiver_position
    d = float(np.linalg.norm(r - s))
    fwd = source_forward(pair.source_id, s, src) if src.directivity is not None else None
    off = None
    if fwd is not None:
        off = math.degrees(math.acos(float(np.clip(np.dot(fwd, (r - s) / d), -1.0, 1.0))))
    return PairGeometry(pair.key, pair.source_id, pair.receiver_id, d, d / c,
                        not segment_hits_mesh(s, r, vertices, faces), off)


def build_pairs_data(pairs: list[MeasuredPair], spec_by_source: dict[str, Optional[dict]]) -> list[dict]:
    """``pairs_data`` of ``run_pffdtd_simulation_from_geometry`` (``source_directivity_spec`` per source)."""
    out = []
    for p in pairs:
        entry = {"source_id": p.source_id, "source_position": p.source_position.tolist(),
                 "receiver_id": p.receiver_id, "receiver_position": p.receiver_position.tolist()}
        if spec_by_source.get(p.source_id):
            entry["source_directivity_spec"] = spec_by_source[p.source_id]
        out.append(entry)
    return out
