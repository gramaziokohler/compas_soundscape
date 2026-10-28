"""Loudspeaker directivity: the app's import of the scene's directivity file, cached per file.

The file goes through the same importer and processing as an uploaded directivity
(``services.directivity_formats.read_balloon`` -> ``services.directivity_processing.process_balloon``)
once; the processed balloon (first-order fit per octave band, as PFFDTD composes it) is cached.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from benchmarks.bras.bras_constants import CACHE_DIR, DIRECTIVITY_STEP_DEG
from benchmarks.bras.bras_scene import yaw_pitch_from_forward
from config.constants import DIRECTIVITY_PROCESSING_VERSION
from services.directivity_formats import FORMAT_BRAS_CSV, read_balloon, read_bras_ir_csv
from services.directivity_processing import load_npz, process_balloon, save_npz


def _stem(path: Path | str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(path).stem)


def balloon_cache_path(path: Path | str, step_deg: int = DIRECTIVITY_STEP_DEG) -> Path:
    return CACHE_DIR / f"{_stem(path)}_step{step_deg}_v{DIRECTIVITY_PROCESSING_VERSION}.npz"


def load_or_build_balloon(path: Path | str, fmt: str, step_deg: int = DIRECTIVITY_STEP_DEG, force: bool = False) -> dict:
    """Processed balloon ``{directions, band_hz, band_energy, fit, irs, fs, meta, ...}`` (cached)."""
    cache = balloon_cache_path(path, step_deg)
    if cache.exists() and not force:
        return load_npz(cache)
    print(f"[bras] importing the directivity {path} (one-time)...", flush=True)
    balloon = read_bras_ir_csv(path, step_deg=step_deg) if fmt == FORMAT_BRAS_CSV else read_balloon(path, fmt)
    save_npz(cache, process_balloon(balloon))
    return load_npz(cache)


def measured_spec(fit: dict, forward, label: str) -> dict:
    """``source_directivity_spec`` of a loudspeaker pointing along ``forward`` (roll 0, upright)."""
    yaw, pitch = yaw_pitch_from_forward(np.asarray(forward, np.float64))
    return {"kind": "measured", "id": f"bench_{label}", "label": label, "fit": fit, "yaw": yaw, "pitch": pitch, "roll": 0.0}
