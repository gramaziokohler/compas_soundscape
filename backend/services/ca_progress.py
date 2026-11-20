"""Live progress of a compas_acoustics run (``services/compas_acoustics_engine.py``).

compas_acoustics reports ``(stage, done, of)`` on the thread that runs it. A :class:`Lane` turns those
reports into a bar fraction and one short line ("Late reverberation (FDN) · 2/3 pairs"). When the
pairs render in several processes, each process writes its reports to a small JSON file
(:class:`LaneWriter`); the job reads them back (:func:`read_lane`) and :func:`summary` makes the
collapsed line and the job's ``partial["ca_progress"]``: one row per process, which the frontend
shows under the progress bar's expand toggle (``SimulationProgress``).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Optional

from config.constants import CA_PROGRESS_SPANS_AMBISONIC
from config.constants import CA_PROGRESS_SPANS_MONO
from config.constants import CA_PROGRESS_STAGE_LABELS
from config.constants import CA_PROGRESS_STAGE_UNITS
from config.constants import CA_PROGRESS_WRITE_S

LANE_QUEUED, LANE_RUNNING, LANE_DONE = "queued", "running", "done"
PARTIAL_KEY = "ca_progress"


def stage_spans(ambisonic: bool) -> dict:
    return CA_PROGRESS_SPANS_AMBISONIC if ambisonic else CA_PROGRESS_SPANS_MONO


def describe(stage: Optional[str], done: Optional[int], of: Optional[int], n_rays: int) -> str:
    """``"Ray tracing · 6,200/15,000 rays"``; the stage's label alone when it has no counts."""
    if not stage:
        return ""
    label = CA_PROGRESS_STAGE_LABELS.get(stage, stage[:1].upper() + stage[1:])
    if done is None:
        return label
    if stage == "ray tracing":
        # split over processes it counts rays (sources x rays), one source at a time it counts sources
        unit = "rays" if n_rays and of and of >= n_rays and of % n_rays == 0 else "sources"
    else:
        unit = CA_PROGRESS_STAGE_UNITS.get(stage, "")
    counts = f"{done:,}/{of:,}" if of else f"{done:,}"
    return f"{label} · {counts} {unit}".rstrip()


def _ranges(numbers: list[int]) -> str:
    """``[1, 2, 3, 5]`` -> ``"1–3, 5"``."""
    runs: list[list[int]] = []
    for n in sorted(numbers):
        if runs and n == runs[-1][1] + 1:
            runs[-1][1] = n
        else:
            runs.append([n, n])
    return ", ".join(str(a) if a == b else f"{a}–{b}" for a, b in runs)


def lane_label(pairs: list[dict], chunk: list[int]) -> str:
    """``"S1–2 → R1–3"``: the run's sources and listeners (numbered in pair order) a part renders."""
    sources = list(dict.fromkeys(str(p["source_id"]) for p in pairs))
    receivers = list(dict.fromkeys(str(p["receiver_id"]) for p in pairs))
    s = {sources.index(str(pairs[i]["source_id"])) + 1 for i in chunk}
    r = {receivers.index(str(pairs[i]["receiver_id"])) + 1 for i in chunk}
    return f"S{_ranges(list(s))} → R{_ranges(list(r))}"


@dataclass
class Lane:
    """One part of the run (a process, or the whole run in one process)."""

    label: str
    pairs: int
    spans: dict
    n_rays: int = 0
    stage: Optional[str] = None
    done: Optional[int] = None
    of: Optional[int] = None
    fraction: float = 0.0
    state: str = LANE_QUEUED
    started: Optional[float] = None
    finished: Optional[float] = None

    def update(self, stage: str, done: Optional[int], of: Optional[int]) -> None:
        if self.state == LANE_DONE:
            return
        if self.state == LANE_QUEUED:
            self.state, self.started = LANE_RUNNING, time.monotonic()
        self.stage, self.done, self.of = stage, done, of
        span = self.spans.get(stage)
        if span is not None:
            inner = min(done / of, 1.0) if (done is not None and of) else 0.0
            # stages without counts, or met twice (the reference's own), never move the bar back
            self.fraction = max(self.fraction, span[0] + (span[1] - span[0]) * inner)

    def finish(self) -> None:
        now = time.monotonic()
        self.state, self.fraction, self.finished = LANE_DONE, 1.0, now
        self.started = self.started or now

    @property
    def text(self) -> str:
        if self.state == LANE_DONE:
            return "Done"
        return describe(self.stage, self.done, self.of, self.n_rays) or ("Waiting" if self.state == LANE_QUEUED else "Starting")

    def as_dict(self) -> dict:
        elapsed = None
        if self.started is not None:
            elapsed = round((self.finished or time.monotonic()) - self.started, 1)
        return {"label": self.label, "pairs": self.pairs, "state": self.state, "text": self.text,
                "fraction": round(self.fraction, 4), "elapsed_s": elapsed}


class LaneWriter:
    """``reporting`` callback of a rendering process: its last report in ``path`` (throttled; a new stage always writes)."""

    def __init__(self, path: str):
        self.path, self._stage, self._at = path, None, 0.0

    def __call__(self, stage: str, done: Optional[int], of: Optional[int]) -> None:
        now = time.monotonic()
        if stage == self._stage and now - self._at < CA_PROGRESS_WRITE_S:
            return
        self._stage, self._at = stage, now
        tmp = f"{self.path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"stage": stage, "done": done, "of": of}, f)
        try:
            os.replace(tmp, self.path)
        except PermissionError:  # the job is reading it (Windows); the next report writes again
            self._at = 0.0


def read_lane(path: str) -> Optional[tuple]:
    """The last ``(stage, done, of)`` a rendering process wrote; None before its first report."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data["stage"], data.get("done"), data.get("of")
    except (OSError, ValueError, KeyError):
        return None


def summary(lanes: list[Lane], pairs_total: int) -> tuple[float, str, dict]:
    """The run's fraction, its line (the slowest running part's step and the pairs done) and its ``partial``."""
    weight = sum(lane.pairs for lane in lanes) or 1
    fraction = sum(lane.fraction * lane.pairs for lane in lanes) / weight
    pairs_done = sum(lane.pairs for lane in lanes if lane.state == LANE_DONE)
    running = [lane for lane in lanes if lane.state == LANE_RUNNING]
    head = min(running, key=lambda lane: lane.fraction).text if running else "Rendering"
    text = f"{head} · pairs {pairs_done}/{pairs_total}"
    detail = {PARTIAL_KEY: {"pairs_done": pairs_done, "pairs_total": pairs_total,
                            "lanes": [lane.as_dict() for lane in lanes]}}
    return fraction, text, detail
