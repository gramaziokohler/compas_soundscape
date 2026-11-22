"""Progress rows of a job's parts that run side by side, shown under the card's expand toggle.

A job puts them in its ``partial[PROGRESS_LANES_PARTIAL_KEY] = {"lanes": [row, ...]}``; a row is
``{label, state, text, fraction, elapsed_s}`` (``state``: queued, running or done). The frontend
reads them with ``progressLanesFromPartial``.

- compas_acoustics rendering processes: ``services/ca_progress.py``.
- The wave solver's runs, one per source (:class:`WaveRuns`, fed by the pipeline's ``COMPAS_RUN``
  lines in ``services/pffdtd_job.py``).
- The hybrid's two parts at once (:class:`HybridProgress`): the geometric part's rows on the CPU and
  the wave part's on the GPU.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Optional

from config.constants import (
    HYBRID_PROGRESS_GA_WEIGHT,
    HYBRID_PROGRESS_PARTS_START,
    HYBRID_PROGRESS_WAVE_END,
    PROGRESS_LANES_PARTIAL_KEY,
    WAVE_RUN_FRACTIONS,
)

LANE_QUEUED, LANE_RUNNING, LANE_DONE = "queued", "running", "done"
CPU_PREFIX, GPU_PREFIX = "CPU · ", "GPU · "

_WAVE_STEP_TEXT = {
    "grid": "Building the grid",
    "prepare": "Preparing",
    "post": "Post-processing",
    "done": "Done",
}


def row(label: str, state: str, text: str, fraction: float, elapsed_s: Optional[float]) -> dict:
    return {"label": label, "state": state, "text": text, "fraction": round(min(max(fraction, 0.0), 1.0), 4),
            "elapsed_s": None if elapsed_s is None else round(elapsed_s, 1)}


def lanes_of(partial: Optional[dict]) -> list[dict]:
    """The rows a ``partial`` holds ([] when none)."""
    detail = (partial or {}).get(PROGRESS_LANES_PARTIAL_KEY)
    return list(detail.get("lanes") or []) if isinstance(detail, dict) else []


def with_lanes(partial: Optional[dict], lanes: list[dict]) -> dict:
    """``partial`` with its rows replaced by ``lanes``."""
    return {**(partial or {}), PROGRESS_LANES_PARTIAL_KEY: {"lanes": lanes}}


def _elapsed(started: Optional[float], finished: Optional[float]) -> Optional[float]:
    return None if started is None else (finished or time.monotonic()) - started


class WaveRuns:
    """The wave solver's runs (one per source, or per listener when it runs reciprocally), from the
    pipeline's ``COMPAS_RUN {"run", "step", "pct", "eta"}`` reports."""

    def __init__(self, n_runs: int, reciprocal: bool = False):
        self.n = n_runs
        self.labels = [f"{'Run' if reciprocal else 'S'}{' ' if reciprocal else ''}{k + 1}" for k in range(n_runs)]
        self.steps: list[Optional[dict]] = [None] * n_runs
        self.started: list[Optional[float]] = [None] * n_runs
        self.finished: list[Optional[float]] = [None] * n_runs

    def update(self, report: dict) -> None:
        k = int(report.get("run", -1))
        if not 0 <= k < self.n:
            return
        now = time.monotonic()
        if self.started[k] is None:
            self.started[k] = now
        if report.get("step") == "done":
            self.finished[k] = now
        self.steps[k] = report

    @staticmethod
    def describe(report: Optional[dict]) -> tuple[str, str, float]:
        """``(state, text, fraction)`` of a run's last report."""
        if report is None:
            return LANE_QUEUED, "Waiting", 0.0
        step = str(report.get("step"))
        if step == "done":
            return LANE_DONE, "Done", 1.0
        if step == "solve":
            pct = float(report.get("pct") or 0.0)
            lo, hi = WAVE_RUN_FRACTIONS["solve"]
            eta = report.get("eta")
            text = f"GPU solve {pct:.0f}%" + (f" · ETA {int(eta)} s" if eta is not None else "")
            return LANE_RUNNING, text, lo + (hi - lo) * pct / 100.0
        return LANE_RUNNING, _WAVE_STEP_TEXT.get(step, step.capitalize()), WAVE_RUN_FRACTIONS.get(step, 0.0)

    def rows(self) -> list[dict]:
        out = []
        for k in range(self.n):
            state, text, fraction = self.describe(self.steps[k])
            out.append(row(self.labels[k], state, text, fraction, _elapsed(self.started[k], self.finished[k])))
        return out


class HybridProgress:
    """The hybrid job's progress while its geometric part (CPU) and wave part (GPU) run at once.

    Each part reports on its own thread; every report rewrites the job's progress with the bar at the
    parts' weighted mean, the collapsed line "Geometric 45% · Wave 20%", and one row per process
    (compas_acoustics) and per wave run, labelled ``CPU · …`` and ``GPU · …``. ``write(value,
    text, partial)`` is the job's progress writer.
    """

    def __init__(self, write: Callable[[float, str, Optional[dict]], None]):
        self._write = write
        self._lock = threading.Lock()
        now = time.monotonic()
        self.ga = {"fraction": 0.0, "text": "Starting", "partial": None, "started": now, "finished": None}
        self.wave = {"fraction": 0.0, "text": "Starting", "partial": None, "started": now, "finished": None}

    @staticmethod
    def _keep_rows(state: dict, partial: Optional[dict]) -> Optional[dict]:
        """A report without rows (a part's last steps) keeps the part's last rows until it finishes."""
        previous = lanes_of(state["partial"])
        return with_lanes(partial, previous) if previous and not lanes_of(partial) else partial

    def geometric(self, fraction: float, text: str, partial: Optional[dict] = None) -> None:
        with self._lock:
            self.ga.update(fraction=min(max(fraction, 0.0), 1.0), text=text, partial=self._keep_rows(self.ga, partial))
            self._report()

    def wave_part(self, value_pct: float, text: str, partial: Optional[dict] = None) -> None:
        with self._lock:
            self.wave.update(fraction=min(max(value_pct / 100.0, 0.0), 1.0), text=text,
                             partial=self._keep_rows(self.wave, partial))
            self._report()

    def finish(self, part: str) -> None:
        with self._lock:
            state = self.ga if part == "geometric" else self.wave
            state.update(fraction=1.0, text="Done", finished=time.monotonic())
            self._report()

    def _part_rows(self, state: dict, prefix: str, name: str) -> list[dict]:
        rows = lanes_of(state["partial"])
        if state["finished"] is not None or not rows:
            done = state["finished"] is not None
            return [row(f"{prefix}{name}", LANE_DONE if done else LANE_RUNNING, state["text"], state["fraction"],
                        _elapsed(state["started"], state["finished"]))]
        return [{**r, "label": f"{prefix}{r['label']}"} for r in rows]

    def snapshot(self) -> tuple[float, str, dict]:
        w = HYBRID_PROGRESS_GA_WEIGHT
        fraction = w * self.ga["fraction"] + (1.0 - w) * self.wave["fraction"]
        value = HYBRID_PROGRESS_PARTS_START + (HYBRID_PROGRESS_WAVE_END - HYBRID_PROGRESS_PARTS_START) * fraction
        text = f"Geometric {self.ga['fraction']:.0%} · Wave {self.wave['fraction']:.0%}"
        wave_stages = {k: v for k, v in (self.wave["partial"] or {}).items() if k != PROGRESS_LANES_PARTIAL_KEY}
        lanes = self._part_rows(self.ga, CPU_PREFIX, "geometric") + self._part_rows(self.wave, GPU_PREFIX, "wave")
        return value, text, with_lanes(wave_stages, lanes)

    def _report(self) -> None:
        self._write(*self.snapshot())
