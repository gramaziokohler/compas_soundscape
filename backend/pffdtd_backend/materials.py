"""Absorption coefficients -> PFFDTD boundary admittance (DEF .h5), with a content-hash cache."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

import pffdtd_backend  # noqa: F401  (puts upstream python/ on sys.path)
from materials.adm_funcs import fit_to_Sabs_oct_11, read_mat_DEF

PFFDTD_OCTAVES = 1000.0 * 2.0 ** np.arange(-6, 5)  # 15.625 Hz .. 16 kHz (11 bands)
ALPHA_MIN = 1e-3  # fit needs a strictly passive, non-rigid admittance
ALPHA_MAX = 0.95  # Paris-formula ceiling for a locally reacting surface (~0.9512)


def to_pffdtd_octaves(alpha, centre_freqs) -> np.ndarray:
    """Interpolate band absorption onto PFFDTD's 11 octaves (log-f), holding the edge values."""
    alpha = np.asarray(alpha, np.float64)
    fc = np.asarray(centre_freqs, np.float64)
    order = np.argsort(fc)
    out = np.interp(np.log2(PFFDTD_OCTAVES), np.log2(fc[order]), alpha[order])
    return np.clip(out, ALPHA_MIN, ALPHA_MAX)


def material_def_file(alpha, centre_freqs, cache_dir: Path) -> Path:
    """Fitted DEF file for these coefficients (cached by content hash)."""
    a11 = to_pffdtd_octaves(alpha, centre_freqs)
    key = hashlib.sha1(json.dumps(np.round(a11, 6).tolist()).encode()).hexdigest()[:16]
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"mat_{key}.h5"
    if not path.exists():
        tmp = path.with_suffix(".tmp.h5")
        fit_to_Sabs_oct_11(a11, filename=tmp, plot=False)
        tmp.replace(path)
    return path


def normal_incidence_reflection(def_file: Path, f: np.ndarray) -> np.ndarray:
    """Plane-wave normal-incidence reflection coefficient R(f) of a DEF material."""
    D, E, F = np.atleast_2d(read_mat_DEF(def_file)).T
    jw = 2j * np.pi * np.asarray(f, np.float64)
    Yn = np.sum(1.0 / (jw[:, None] * D[None, :] + E[None, :] + F[None, :] / jw[:, None]), axis=-1)
    return (1.0 - Yn) / (1.0 + Yn)
