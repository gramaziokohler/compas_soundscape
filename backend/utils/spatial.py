"""Room-extent helpers for the scenario agents (scenarist / foley / speech).

Stateless: bounds are ``total_bounds`` dicts ``{"min": [x, y, z], "max": [x, y, z],
"width", "depth", "height"}`` in Speckle Z-up metres (X = width, Y = depth,
Z = height).
"""

from __future__ import annotations

import math

from config.constants import (
    SCENARIO_ROOM_DIM_MAX_M,
    SCENARIO_ROOM_DIM_MIN_M,
    bounds_from_dimensions,
)


def _xyz(values: object) -> list[float] | None:
    """First three finite floats of a list, or None."""
    if not isinstance(values, (list, tuple)) or len(values) < 3:
        return None
    try:
        out = [float(values[0]), float(values[1]), float(values[2])]
    except (TypeError, ValueError):
        return None
    return out if all(math.isfinite(v) for v in out) else None


def scenario_room_bounds(scenario_data: dict | None) -> dict | None:
    """Room bounds from the ``roomDimensions`` [w, d, h] the scenarist read from
    the prompt or image, or None when absent / implausible."""
    scenarios = (scenario_data or {}).get("scenarios") or []
    if not scenarios or not isinstance(scenarios[0], dict):
        return None
    dims = _xyz(scenarios[0].get("roomDimensions"))
    if dims is None:
        return None
    if not all(SCENARIO_ROOM_DIM_MIN_M <= v <= SCENARIO_ROOM_DIM_MAX_M for v in dims):
        return None
    return bounds_from_dimensions(*dims)


def room_extents_text(bounds: dict | None) -> str | None:
    """Readable per-axis extents for an LLM prompt, e.g.
    "x from -4.00 to 4.00 m (width 8.00 m), y from ... z from 0.00 (floor) to 4.00 m (ceiling, height 4.00 m)"."""
    if not bounds:
        return None
    mn = _xyz(bounds.get("min"))
    mx = _xyz(bounds.get("max"))
    if mn is None or mx is None:
        return None
    return (
        f"x from {mn[0]:.2f} to {mx[0]:.2f} m (width {mx[0] - mn[0]:.2f} m), "
        f"y from {mn[1]:.2f} to {mx[1]:.2f} m (depth {mx[1] - mn[1]:.2f} m), "
        f"z from {mn[2]:.2f} (floor) to {mx[2]:.2f} m (ceiling, height {mx[2] - mn[2]:.2f} m)"
    )


def clamp_position(position: object, bounds: dict | None, margin: float) -> list[float]:
    """Clamp an [x, y, z] guess inside ``bounds``.

    X and Y are kept ``margin`` away from the walls; Z is only kept between
    floor and ceiling (footsteps sit on the floor). Returns [] for a malformed
    position (the caller's "no position" value), and the position unchanged
    when there are no usable bounds. An axis thinner than twice the margin
    collapses to its centre.
    """
    pos = _xyz(position)
    if pos is None:
        return []
    mn = _xyz((bounds or {}).get("min"))
    mx = _xyz((bounds or {}).get("max"))
    if mn is None or mx is None:
        return pos
    out: list[float] = []
    for axis, (v, lo, hi) in enumerate(zip(pos, mn, mx)):
        lo, hi = min(lo, hi), max(lo, hi)
        if axis == 2:
            out.append(round(min(hi, max(lo, v)), 3))
        elif hi - lo <= 2 * margin:
            out.append(round((lo + hi) / 2, 3))
        else:
            out.append(round(min(hi - margin, max(lo + margin, v)), 3))
    return out
