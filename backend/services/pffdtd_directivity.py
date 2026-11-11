"""Source directivity entries of a PFFDTD job (``job["source_directivities"]``).

The PFFDTD pipeline runs in its own environment and never opens a balloon file: each
directional source travels as its first-order band fit (from the pair's
``source_directivity_spec``) with the band axes already rotated into the world frame.
"""

from __future__ import annotations

import os
from typing import Optional

import numpy as np

from config.constants import (
    PFFDTD_HIGH_ORDER_DIRECTIVITY_ENV,
    PFFDTD_HO_BALLOON_ORDER,
    PFFDTD_HO_BESSEL_FLOOR,
    PFFDTD_HO_MAX_ORDER,
    PFFDTD_HO_PROBE_RADIUS_CELLS,
    PFFDTD_HO_TOP_FRACTION,
)
from utils.orientation import rotation_matrix


def high_order_enabled() -> bool:
    """The benchmark-only high-order directivity switch (never set by the app)."""
    return os.environ.get(PFFDTD_HIGH_ORDER_DIRECTIVITY_ENV, "").strip() == "1"


def high_order_entry(spec: dict, rot: np.ndarray, params: Optional[dict] = None) -> dict:
    """World-frame spherical-harmonic coefficients of the measured balloon's magnitude per
    frequency (pffdtd_backend/directional_ho.py). ``spec["balloon_npz"]`` is the processed balloon."""
    from pffdtd_backend.directional_ho import real_sh
    from services.directivity_processing import area_weights, load_npz

    p = {"radius_cells": PFFDTD_HO_PROBE_RADIUS_CELLS, "max_order": PFFDTD_HO_MAX_ORDER,
         "bessel_floor": PFFDTD_HO_BESSEL_FLOOR, "balloon_order": PFFDTD_HO_BALLOON_ORDER, **(params or {})}
    b = load_npz(spec["balloon_npz"])
    dirs = np.asarray(b["directions"], np.float64)
    mag = np.abs(np.fft.rfft(np.asarray(b["irs"], np.float64), axis=-1))     # [n_dir, n_f]: 1 = unit impulse
    freqs = np.fft.rfftfreq(np.asarray(b["irs"]).shape[-1], 1.0 / float(b["fs"]))
    Y = real_sh(int(p["balloon_order"]), dirs @ rot.T)
    coeffs = (4.0 * np.pi) * (mag.T * area_weights(dirs)[None, :]) @ Y   # [n_f, (N+1)^2]: integral of |H| Y
    return {"freqs_hz": freqs.tolist(), "coeffs": coeffs.tolist(), "radius_cells": float(p["radius_cells"]),
            "max_order": int(p["max_order"]), "bessel_floor": float(p["bessel_floor"]),
            "top_fraction": PFFDTD_HO_TOP_FRACTION,
            **({"dump_dir": p["dump_dir"]} if p.get("dump_dir") else {})}


def directional_job_entry(spec: Optional[dict]) -> Optional[dict]:
    """``{id, label, bands_hz, a, gain, axis_world}`` of a spec (plus ``high_order`` when the spec
    asks for it and the benchmark switch is on), or None for omnidirectional."""
    if not spec:
        return None
    fit = spec["fit"]
    rot = rotation_matrix(float(spec.get("yaw", 0.0)), float(spec.get("pitch", 0.0)), float(spec.get("roll", 0.0)))
    axes = np.asarray(fit["axis"], dtype=np.float64).reshape(-1, 3) @ rot.T
    extra = {}
    if spec.get("high_order") and high_order_enabled():
        extra["high_order"] = high_order_entry(spec, rot, spec["high_order"] if isinstance(spec["high_order"], dict) else None)
    return {
        **extra,
        "id": spec.get("id"),
        "label": spec.get("label"),
        "kind": spec.get("kind"),
        "bands_hz": [float(f) for f in fit.get("bands_hz", [])],
        "a": [float(v) for v in fit["a"]],
        "gain": [float(v) for v in fit["gain"]],
        "axis_world": axes.tolist(),
    }


def job_source_directivities(sources, pairs_data: list[dict]) -> list[Optional[dict]]:
    """One entry per unique source (in ``sources`` order; None = omni)."""
    spec_by_source: dict[str, Optional[dict]] = {}
    for pair in pairs_data:
        spec_by_source.setdefault(str(pair["source_id"]), pair.get("source_directivity_spec"))
    return [directional_job_entry(spec_by_source.get(str(sid))) for sid in sources]
