"""Source directivity entries of a PFFDTD job (``job["source_directivities"]``).

The PFFDTD pipeline runs in its own environment and never opens a balloon file: each
directional source travels as its first-order band fit (from the pair's
``source_directivity_spec``) with the band axes already rotated into the world frame.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from utils.orientation import rotation_matrix


def directional_job_entry(spec: Optional[dict]) -> Optional[dict]:
    """``{id, label, bands_hz, a, gain, axis_world}`` of a spec, or None for omnidirectional."""
    if not spec:
        return None
    fit = spec["fit"]
    rot = rotation_matrix(float(spec.get("yaw", 0.0)), float(spec.get("pitch", 0.0)), float(spec.get("roll", 0.0)))
    axes = np.asarray(fit["axis"], dtype=np.float64).reshape(-1, 3) @ rot.T
    return {
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
