"""
PFFDTD free positioning, compas-toy side (worker + API; never imports pffdtd_backend).

A simulation with free positioning keeps a raw store in PFFDTD_FREE_DIR/<simulation_id>/
(written by pffdtd_backend/free_runs.py; layout in pffdtd_backend/free_ir.py). After the run a
moved listener ("listener" mode) or source ("source" mode) snaps to the nearest valid grid point
within PFFDTD_FREE_SNAP_RADIUS_M, and services/pffdtd_ir_server.py renders that point's IRs
(one per fixed source / listener) as WAVs next to the run's IRs in PFFDTD_RIR_DIR.
"""
from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
from scipy.io import wavfile

from utils.acoustic_measurement import AcousticMeasurement
from config.constants import (
    PFFDTD_DEFAULT_FREE_MODE,
    PFFDTD_FREE_DIR,
    PFFDTD_FREE_GRID_SPACING_DEFAULT,
    PFFDTD_FREE_MAX_DISK_BYTES,
    PFFDTD_FREE_MAX_RECORD_BYTES,
    PFFDTD_FREE_MODE_LISTENER,
    PFFDTD_FREE_MODE_OFF,
    PFFDTD_FREE_MODE_SOURCE,
    PFFDTD_FREE_SNAP_RADIUS_M,
    PFFDTD_IR_REFERENCE_GAIN,
    PFFDTD_PREVIEW_MAX_LABEL_NODES,
    PFFDTD_RIR_DIR,
    PFFDTD_SEED_CLEARANCE_CELLS,
)

FREE_META = "free.json"      # names shared with pffdtd_backend/free_ir.py
FREE_POINTS = "free_points.bin"
_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]")


@dataclass
class FreeOptions:
    mode: str = PFFDTD_DEFAULT_FREE_MODE
    spacing_m: float = PFFDTD_FREE_GRID_SPACING_DEFAULT

    @property
    def enabled(self) -> bool:
        return self.mode != PFFDTD_FREE_MODE_OFF

    @property
    def reciprocal(self) -> bool:
        return self.mode == PFFDTD_FREE_MODE_SOURCE


def free_dir(simulation_id: str) -> Path:
    return Path(PFFDTD_FREE_DIR) / simulation_id


def reset_store(simulation_id: str) -> None:
    """Remove a previous raw store and its cached WAVs (a re-run under the same id)."""
    shutil.rmtree(free_dir(simulation_id), ignore_errors=True)
    for wav in Path(PFFDTD_RIR_DIR).glob(f"pffdtd_{simulation_id}_free_*.wav"):
        wav.unlink(missing_ok=True)


def job_block(simulation_id: str, opts: FreeOptions) -> dict:
    """``job["free"]`` for the pipeline (call reset_store first)."""
    return {
        "mode": opts.mode,
        "spacing_m": float(opts.spacing_m),
        "dir": str(free_dir(simulation_id)),
        "clearance_cells": PFFDTD_SEED_CLEARANCE_CELLS,
        "max_record_bytes": PFFDTD_FREE_MAX_RECORD_BYTES,
        "max_disk_bytes": PFFDTD_FREE_MAX_DISK_BYTES,
        "max_label_nodes": PFFDTD_PREVIEW_MAX_LABEL_NODES,
        "ir_gain": PFFDTD_IR_REFERENCE_GAIN,
    }


def results_block(simulation_id: str, summary: dict, source_ids: list, receiver_ids: list) -> dict:
    """Results-JSON ``free`` block; also records the fixed ids (index order) in free.json."""
    fixed_ids = [str(i) for i in (source_ids if summary["mode"] == PFFDTD_FREE_MODE_LISTENER else receiver_ids)]
    meta_path = free_dir(simulation_id) / FREE_META
    meta = json.loads(meta_path.read_text())
    meta["fixed_ids"] = fixed_ids
    meta_path.write_text(json.dumps(meta))
    return {
        "mode": summary["mode"],
        "foa": summary["foa"],
        "spacing_m": summary["spacing_m"],
        "requested_spacing_m": summary["requested_spacing_m"],
        "snap_radius_m": PFFDTD_FREE_SNAP_RADIUS_M,
        "n_points": summary["n_points"],
        "n_valid": summary["n_valid"],
        "connectivity_checked": summary["connectivity_checked"],
        "fixed_ids": fixed_ids,
    }


def load_meta(simulation_id: str) -> Optional[dict]:
    path = free_dir(simulation_id) / FREE_META
    if not path.exists():
        return None
    return _load_json(str(path), path.stat().st_mtime_ns)


@lru_cache(maxsize=16)
def _load_json(path: str, _mtime: int) -> dict:
    return json.loads(Path(path).read_text())


def points_path(simulation_id: str) -> Path:
    return free_dir(simulation_id) / FREE_POINTS


@lru_cache(maxsize=16)
def _load_points(path: str, _mtime: int) -> tuple[np.ndarray, np.ndarray]:
    raw = Path(path).read_bytes()
    n = len(raw) // 13  # float32 xyz + uint8 valid per point
    xyz = np.frombuffer(raw, np.float32, 3 * n).reshape(n, 3)
    valid = np.frombuffer(raw, np.uint8, n, offset=12 * n).astype(bool)
    return xyz, valid


def nearest_point(simulation_id: str, position) -> tuple[int, list, float]:
    """(point index, snapped position, distance) of the nearest valid grid point."""
    path = points_path(simulation_id)
    xyz, valid = _load_points(str(path), path.stat().st_mtime_ns)
    idx = np.flatnonzero(valid)
    if idx.size == 0:
        raise ValueError("the free grid has no valid point")
    d = np.linalg.norm(xyz[idx].astype(np.float64) - np.asarray(position, np.float64), axis=1)
    k = int(np.argmin(d))
    return int(idx[k]), xyz[idx[k]].astype(float).tolist(), float(d[k])


@lru_cache(maxsize=512)
def _measure_ir(path: str, _mtime: int) -> dict:
    fs, data = wavfile.read(path)
    w = data if data.ndim == 1 else data[:, 0]  # mono, or the W channel of an FOA IR
    return AcousticMeasurement.calculate_acoustic_parameters_from_rir(w.astype(np.float64), int(fs))


def ir_metrics(path: Path) -> Optional[dict]:
    """Acoustic parameters of one rendered IR WAV (cached per file; a few ms for a 1 s IR)."""
    try:
        return _measure_ir(str(path), path.stat().st_mtime_ns) or None
    except Exception:
        return None


def ir_filename(simulation_id: str, point: int, fixed_id: str) -> str:
    return f"pffdtd_{simulation_id}_free_p{point}_{_UNSAFE.sub('_', str(fixed_id))}.wav"
