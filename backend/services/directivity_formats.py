"""Readers for measured source directivities: SOFA (via h5py) and the BRAS front-pole CSV.

Both return a ``Balloon``: unit direction vectors in the *source frame* (+x front, +y
left, +z up) and one impulse response per direction at the file's sampling rate.
Processing (resampling, cropping, band fit) happens in directivity_processing.py.

SOFA is netCDF-4, i.e. HDF5, so ``h5py`` reads it without python-sofa. Supported layouts:

* a *sources* file (DIRPAT style): ``Data.IR`` is (M sources, R mic directions, N),
  the balloon of one source ``m`` is ``Data.IR[m]`` over the receivers;
* one source measured with one microphone per measurement: ``Data.IR`` is (M, 1, N)
  and ``ReceiverPosition`` has one position per measurement (R, C, M).

HRIR files (``SimpleFreeFieldHRIR``) describe a receiver and are rejected, as is a
layout where the source moves around a fixed microphone.

The bundled DIRPAT file flattens its mic grid wrongly and stores radians although its
units say degrees; the same surgery as the pyroomacoustics fork's ``_read_dirpat`` is
applied when the file stem matches ``DIRECTIVITY_SOFA_DIRPAT_STEM``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from config.constants import (
    DIRECTIVITY_BRAS_FS,
    DIRECTIVITY_BRAS_LINE_RE,
    DIRECTIVITY_GRID_STEP_DEG,
    DIRECTIVITY_MIN_GRID_POINTS,
    DIRECTIVITY_SOFA_DIRPAT_LABELS,
    DIRECTIVITY_SOFA_DIRPAT_RESHAPE,
    DIRECTIVITY_SOFA_DIRPAT_STEM,
)
from utils.orientation import front_pole_to_cartesian, spherical_to_cartesian, unit

FORMAT_SOFA = "sofa"
FORMAT_BRAS_CSV = "bras_csv"
_FORMAT_BY_EXT = {".sofa": FORMAT_SOFA, ".csv": FORMAT_BRAS_CSV}

_MPS_HINT = "This looks like a BRAS third-octave spectrum (MPS) file; import the *_IR_front_pole.csv instead."


@dataclass
class Balloon:
    directions: np.ndarray  # (n, 3) unit vectors, source frame
    irs: np.ndarray         # (n, taps) float64
    fs: float
    fmt: str
    label: str = ""


# ── format detection ────────────────────────────────────────────────────────

def detect_format(filename: str) -> str:
    fmt = _FORMAT_BY_EXT.get(Path(filename).suffix.lower())
    if fmt is None:
        raise ValueError("Unsupported file type: use a .sofa file or a BRAS *_IR_front_pole.csv")
    return fmt


def inspect_file(path: Path | str, fmt: str) -> dict:
    """Cheap look at a staged upload (no IR processing)."""
    path = Path(path)
    if fmt == FORMAT_SOFA:
        return _inspect_sofa(path)
    if fmt == FORMAT_BRAS_CSV:
        return _inspect_bras_csv(path)
    raise ValueError(f"Unknown directivity format: {fmt}")


def read_balloon(path: Path | str, fmt: str, source: Optional[str] = None) -> Balloon:
    if fmt == FORMAT_SOFA:
        return read_sofa_source_balloon(path, source)
    if fmt == FORMAT_BRAS_CSV:
        return read_bras_ir_csv(path)
    raise ValueError(f"Unknown directivity format: {fmt}")


# ── SOFA ────────────────────────────────────────────────────────────────────

def _attr(obj, name: str, default: str = "") -> str:
    value = obj.attrs.get(name, default)
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return str(value).strip()


def _is_dirpat(path: Path) -> bool:
    return path.stem == DIRECTIVITY_SOFA_DIRPAT_STEM


@dataclass
class _SofaLayout:
    convention: str
    n_measurements: int
    n_receivers: int
    n_samples: int
    fs: float
    receiver_pos: np.ndarray   # (R, 3) or (R, 3, M)
    receiver_type: str
    receiver_degrees: bool
    source_pos: np.ndarray     # (M, 3)


def _open_layout(path: Path):
    import h5py

    f = h5py.File(path, "r")
    try:
        ir = f["Data.IR"]
        if ir.ndim != 3:
            raise ValueError("Data.IR must be (M, R, N) — only FIR SOFA files are supported")
        rp = f["ReceiverPosition"]
        units = _attr(rp, "Units", "metre")
        first_unit = units.split(",")[0].strip().lower()
        sp = f["SourcePosition"][...] if "SourcePosition" in f else np.zeros((ir.shape[0], 3))
        if sp.ndim == 3:
            sp = sp[..., 0]
        layout = _SofaLayout(
            convention=_attr(f, "GLOBAL_SOFAConventions"),
            n_measurements=int(ir.shape[0]),
            n_receivers=int(ir.shape[1]),
            n_samples=int(ir.shape[2]),
            fs=float(np.asarray(f["Data.SamplingRate"][...]).ravel()[0]),
            receiver_pos=np.asarray(rp[...], dtype=np.float64),
            receiver_type=_attr(rp, "Type", "cartesian").lower(),
            receiver_degrees=first_unit.startswith("degree"),
            source_pos=np.asarray(sp, dtype=np.float64),
        )
        return f, layout
    except Exception:
        f.close()
        raise


def _directions_from_positions(pos: np.ndarray, pos_type: str, degrees: bool, dirpat: bool) -> np.ndarray:
    """(n, 3) positions (cartesian metres or spherical az/col-or-el/r) -> unit vectors."""
    pos = np.asarray(pos, dtype=np.float64)
    if pos_type == "cartesian":
        return unit(pos)
    az, second = pos[:, 0].copy(), pos[:, 1].copy()
    if dirpat:
        degrees = False  # the DIRPAT files store radians although Units says degrees
    elif degrees and pos.shape[0] > 36 and np.abs(az).max() <= 2 * np.pi + 1e-3:
        degrees = False  # a balloon whose azimuths never exceed 6.3 "degrees" is in radians
    if degrees:
        az, second = np.deg2rad(az), np.deg2rad(second)
    if np.any(second < 0.0):
        second = np.pi / 2.0 - second  # elevation -> colatitude
    return spherical_to_cartesian(az, second)


def _receiver_directions(layout: _SofaLayout, measurement: int, dirpat: bool) -> np.ndarray:
    rp = layout.receiver_pos
    if rp.ndim == 3:
        rp = rp[..., measurement] if rp.shape[-1] > 1 else rp[..., 0]
    if dirpat:
        n = rp.shape[0]
        rp = rp.reshape(DIRECTIVITY_SOFA_DIRPAT_RESHAPE, -1, 3).swapaxes(0, 1).reshape(n, 3)
    return _directions_from_positions(rp, layout.receiver_type, layout.receiver_degrees, dirpat)


def _per_measurement_receivers(layout: _SofaLayout) -> bool:
    rp = layout.receiver_pos
    return layout.n_receivers == 1 and layout.n_measurements > 1 and rp.ndim == 3 and rp.shape[-1] == layout.n_measurements


def _source_labels(path: Path, layout: _SofaLayout) -> list[str]:
    if _is_dirpat(path) and layout.n_measurements == len(DIRECTIVITY_SOFA_DIRPAT_LABELS):
        return list(DIRECTIVITY_SOFA_DIRPAT_LABELS)
    return [f"Source {i + 1}" for i in range(layout.n_measurements)]


def _inspect_sofa(path: Path) -> dict:
    f, layout = _open_layout(path)
    f.close()
    warning = None
    if layout.convention == "SimpleFreeFieldHRIR":
        warning = "HRIR file: this describes a receiver (head), not a sound source"
    if _per_measurement_receivers(layout):
        return {"format": FORMAT_SOFA, "sofa_sources": [], "fs": layout.fs,
                "n_points": layout.n_measurements, "warning": warning}
    if layout.n_receivers > 1:
        labels = _source_labels(path, layout) if layout.n_measurements > 1 else []
        return {"format": FORMAT_SOFA, "sofa_sources": labels, "fs": layout.fs,
                "n_points": layout.n_receivers, "warning": warning}
    return {"format": FORMAT_SOFA, "sofa_sources": [], "fs": layout.fs, "n_points": None,
            "warning": warning or "The source moves around one microphone: a microphone / HRIR layout, not a source balloon"}


def _resolve_source_index(layout: _SofaLayout, labels: list[str], source: Optional[str]) -> int:
    if layout.n_measurements == 1:
        return 0
    if source is None or source == "":
        if layout.n_measurements > 1:
            raise ValueError(f"This SOFA file holds {layout.n_measurements} sources; choose one")
        return 0
    if source in labels:
        return labels.index(source)
    try:
        idx = int(source)
    except ValueError:
        raise ValueError(f"Unknown source '{source}' in the SOFA file")
    if not 0 <= idx < layout.n_measurements:
        raise ValueError(f"Source index {idx} out of range (0..{layout.n_measurements - 1})")
    return idx


def read_sofa_source_balloon(path: Path | str, source: Optional[str] = None) -> Balloon:
    """Balloon of one source of a SOFA FIR file (``source`` = label or index)."""
    path = Path(path)
    f, layout = _open_layout(path)
    try:
        if layout.convention == "SimpleFreeFieldHRIR":
            raise ValueError("HRIR files describe a receiver (head); import a source directivity file")
        dirpat = _is_dirpat(path)
        if _per_measurement_receivers(layout):
            # one microphone per measurement around a single source
            dirs = np.vstack([_receiver_directions(layout, m, False) for m in range(layout.n_measurements)])
            irs = np.asarray(f["Data.IR"][:, 0, :], dtype=np.float64)
            label = ""
        elif layout.n_receivers > 1:
            labels = _source_labels(path, layout)
            m = _resolve_source_index(layout, labels, source)
            dirs = _receiver_directions(layout, m, dirpat)
            irs = np.asarray(f["Data.IR"][m, :, :], dtype=np.float64)
            label = labels[m] if layout.n_measurements > 1 else ""
        else:
            raise ValueError(
                "The source moves around one fixed microphone in this file (a microphone / HRIR layout); "
                "a source balloon needs microphones around the source"
            )
    finally:
        f.close()
    if dirs.shape[0] < DIRECTIVITY_MIN_GRID_POINTS:
        raise ValueError(f"Only {dirs.shape[0]} directions in the file; a balloon needs at least {DIRECTIVITY_MIN_GRID_POINTS}")
    return Balloon(directions=dirs, irs=irs, fs=layout.fs, fmt=FORMAT_SOFA, label=label)


# ── BRAS front-pole CSV ─────────────────────────────────────────────────────

_LINE_RE = re.compile(DIRECTIVITY_BRAS_LINE_RE)


def _parse_label(label: str) -> tuple[int, int]:
    m = _LINE_RE.match(label.strip())
    if not m:
        if label.strip().lower().startswith("f in hz"):
            raise ValueError(_MPS_HINT)
        raise ValueError(f"Unexpected line start '{label[:12]}': BRAS IR lines begin with PxxxTyyy")
    return int(m.group(1)), int(m.group(2))


def _parse_values(rest: str) -> np.ndarray:
    if "i" in rest or "j" in rest:
        raise ValueError(_MPS_HINT)
    values = np.fromstring(rest, sep=",")
    if values.size == 0:
        raise ValueError("A BRAS IR line holds no numeric samples")
    return values


def _inspect_bras_csv(path: Path) -> dict:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        first = fh.readline()
    label, _, rest = first.partition(",")
    _parse_label(label)
    values = _parse_values(rest)
    step = DIRECTIVITY_GRID_STEP_DEG
    n_points = (360 // step) * (180 // step - 1) + 2
    return {"format": FORMAT_BRAS_CSV, "sofa_sources": [], "fs": float(DIRECTIVITY_BRAS_FS),
            "n_points": n_points, "warning": None if values.size > 16 else "Very short impulse responses"}


def read_bras_ir_csv(path: Path | str, step_deg: int = DIRECTIVITY_GRID_STEP_DEG) -> Balloon:
    """Stream a BRAS ``*_IR_front_pole.csv`` keeping every ``step_deg`` grid point."""
    phis: list[int] = []
    thetas: list[int] = []
    rows: list[np.ndarray] = []
    poles_seen: set[int] = set()
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            label, _, rest = line.partition(",")
            phi, theta = _parse_label(label)
            if phi % step_deg or theta % step_deg:
                continue
            if theta in (0, 180):  # every phi maps to the same pole point
                if theta in poles_seen:
                    continue
                poles_seen.add(theta)
            rows.append(_parse_values(rest))
            phis.append(phi)
            thetas.append(theta)
    if len(rows) < DIRECTIVITY_MIN_GRID_POINTS:
        raise ValueError(f"Only {len(rows)} grid points found; expected a full 1° BRAS balloon")
    taps = min(r.size for r in rows)
    irs = np.vstack([r[:taps] for r in rows])
    dirs = front_pole_to_cartesian(np.asarray(phis), np.asarray(thetas))
    return Balloon(directions=dirs, irs=irs, fs=float(DIRECTIVITY_BRAS_FS), fmt=FORMAT_BRAS_CSV)
