"""Source directivity for the pyroomacoustics engine.

A pair's ``source_directivity_spec`` (services/directivity_service.py) becomes:

* analytical — ``CardioidFamily(orientation=forward, p)``; ``p = 1`` stays omni;
* measured   — ``MeasuredDirectivity`` built from the stored balloon with its grid
  pre-rotated into the world frame (identity ``Rotation3D``), so the engine's own
  Euler convention never enters; ``get_response`` at the forward direction returns
  the on-axis impulse response.

The local fork applies both to the image-source method (per-image convolution for
measured IRs) and to ray tracing (``sample_rays``). ``Room.add_source`` silently
ignores any other directivity class, hence ``add_source_with_directivity`` checks
that a source was really added.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from config.constants import DIRECTIVITY_SAMPLE_RATE
from services.directivity_processing import load_npz
from utils.orientation import forward_vector, rotate_source_frame

KIND_ANALYTICAL = "analytical"
KIND_MEASURED = "measured"


def build_pra_directivity(spec: Optional[dict]):
    """pyroomacoustics directivity object for a spec, or None for omnidirectional."""
    if not spec:
        return None
    from pyroomacoustics.directivities import CardioidFamily, MeasuredDirectivity, Rotation3D
    from pyroomacoustics.doa import GridSphere

    yaw, pitch, roll = (float(spec.get(k, 0.0)) for k in ("yaw", "pitch", "roll"))
    kind = spec.get("kind")
    if kind == KIND_ANALYTICAL:
        p = float(spec["p"])
        if p >= 1.0 - 1e-9:
            return None
        return CardioidFamily(orientation=forward_vector(yaw, pitch), p=p, gain=1.0)
    if kind == KIND_MEASURED:
        data = load_npz(spec["path"])
        if int(data["fs"]) != int(DIRECTIVITY_SAMPLE_RATE):
            raise ValueError(f"Directivity balloon sampled at {data['fs']} Hz, expected {DIRECTIVITY_SAMPLE_RATE}")
        grid_world = rotate_source_frame(data["directions"], yaw, pitch, roll)
        grid = GridSphere(cartesian_points=np.ascontiguousarray(grid_world.T))
        return MeasuredDirectivity(Rotation3D([], rot_order=""), grid, data["irs"], int(data["fs"]))
    raise ValueError(f"Unknown source directivity kind: {kind!r}")


def add_source_with_directivity(room, position, spec: Optional[dict]) -> None:
    """``room.add_source`` with the spec's directivity; raises if the engine dropped it."""
    directivity = build_pra_directivity(spec)
    before = len(room.sources)
    room.add_source(position, directivity=directivity)
    if len(room.sources) != before + 1:
        raise RuntimeError(
            "pyroomacoustics ignored the source directivity "
            f"({type(directivity).__name__}); the installed build does not support it"
        )


def directivity_result_entry(spec: Optional[dict]) -> Optional[dict]:
    """What the results JSON records for a directional source."""
    if not spec:
        return None
    return {
        "id": spec.get("id"), "label": spec.get("label"), "kind": spec.get("kind"),
        "yaw": float(spec.get("yaw", 0.0)), "pitch": float(spec.get("pitch", 0.0)), "roll": float(spec.get("roll", 0.0)),
    }
