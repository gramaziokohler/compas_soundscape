"""Wall-clock solve time of a simulation run, recorded in its results JSON as ``solve_time_s``."""

from __future__ import annotations

import time
from typing import Optional


def solve_started(started: Optional[float] = None) -> float:
    """The run's start (a ``time.monotonic()`` reading): ``started`` when the caller began timing
    earlier (e.g. before the Speckle fetch), else now."""
    return time.monotonic() if started is None else started


def solve_time_s(started: float) -> float:
    """Seconds since ``started`` (from ``solve_started``), to a tenth of a second."""
    return round(time.monotonic() - started, 1)
