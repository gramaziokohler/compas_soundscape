# backend/utils/recurrence.py
"""Recurring foley activities: expansion into occurrences and trigger chains.

An ongoing activity (reading, typing, sipping, walking back and forth) is
emitted by the foley agent with a ``recurrence`` instead of hand-listed
timestamps::

    {"perMinute": 2, "regularity": "irregular", "start": "after(chair_sit_1#1)", "end": "00:30"}

``expand_recurrence`` turns it into occurrence times (authored hints) with
seeded, irregular gaps and derives the copy count. ``recurrence_trigger``
turns those gaps into an orchestrate trigger chain — occurrence 1 at ``start``
(an absolute time or a cause such as ``after(chair_sit_1#1)``), occurrence k at
``after(<self>#k-1)`` — so the frontend solver places each one from the real
measured clip durations and a moved cause takes the whole chain along.

Stateless and pure: no service or FastAPI imports.
"""

from __future__ import annotations

import hashlib
import math
import random
import re

from config.constants import (
    MAX_SEED_COPIES,
    RECURRENCE_DEFAULT_DURATION_S,
    RECURRENCE_JITTER_IRREGULAR,
    RECURRENCE_JITTER_STEADY,
    RECURRENCE_MAX_OCCURRENCES,
    RECURRENCE_MIN_GAP_S,
    RECURRENCE_OCCURRENCES_PER_COPY,
)

_ABS_RE = re.compile(r"^\s*(\d+):(\d+(?:\.\d+)?)\s*$")
_CAUSE_RE = re.compile(r"^\s*(after|overlap)\(\s*([^()]+?)\s*\)\s*$")


def parse_mmss(value) -> float | None:
    """``"01:05"`` / ``"65"`` / ``65`` → seconds; ``None`` when unparseable."""
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if not isinstance(value, str):
        return None
    m = _ABS_RE.match(value)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    try:
        f = float(value.strip())
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def format_mmss(seconds: float) -> str:
    """Seconds → ``MM:SS`` (whole seconds, as the agents write them)."""
    s = max(0, int(round(seconds)))
    return f"{s // 60:02d}:{s % 60:02d}"


def parse_cause(start) -> tuple[str, str] | None:
    """``"after(chair_sit_1#1)"`` → ``("after", "chair_sit_1#1")``; ``None`` otherwise."""
    if not isinstance(start, str):
        return None
    m = _CAUSE_RE.match(start)
    if not m or "," in m.group(2):
        return None
    return m.group(1), m.group(2).strip()


def reference_entry_id(ref: str) -> str:
    """``"chair_sit_1#2"`` → ``"chair_sit_1"``."""
    return ref.split("#")[0].strip()


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def _clamped_copy_count(value, fallback: int = 1) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = fallback
    return max(1, min(MAX_SEED_COPIES, n))


def clamp_copy_count(entry: dict) -> dict:
    """Keep a foley entry's ``copyCount`` within 1..MAX_SEED_COPIES (beds always 1)."""
    entry["copyCount"] = _clamped_copy_count(entry.get("copyCount", 1))
    return entry


def expand_recurrence(
    entry: dict,
    scene_seconds: float,
    seed_key: str,
    rate_multiplier: float = 1.0,
) -> dict:
    """Spread a recurring entry's occurrences over its active window.

    Writes ``timestamps`` (MM:SS hints, first one = the window start), ``copyCount``
    and ``recurrence.gaps`` (end-to-start seconds between consecutive occurrences)
    on a copy of ``entry``. Entries without a usable ``recurrence`` come back
    unchanged apart from the copy-count clamp.
    """
    out = dict(entry)
    rec = out.get("recurrence")
    if not isinstance(rec, dict):
        return clamp_copy_count(out)
    try:
        per_minute = float(rec.get("perMinute") or 0) * float(rate_multiplier)
    except (TypeError, ValueError):
        per_minute = 0.0
    if per_minute <= 0:
        out["recurrence"] = None
        return clamp_copy_count(out)

    duration = parse_mmss(out.get("duration")) or RECURRENCE_DEFAULT_DURATION_S
    scene_end = max(scene_seconds, 0.0)

    # Window start: an absolute start, else (a cause) the agent's first hint.
    hints = [t for t in (parse_mmss(x) for x in out.get("timestamps") or []) if t is not None]
    start = parse_mmss(rec.get("start"))
    if start is None:
        start = hints[0] if hints else 0.0
    end = parse_mmss(rec.get("end"))
    if end is None or end > scene_end:
        end = scene_end
    start = max(0.0, min(start, max(end - duration, 0.0)))

    period = 60.0 / per_minute
    mean_gap = max(RECURRENCE_MIN_GAP_S, period - duration)
    steady = str(rec.get("regularity", "irregular")).lower() == "steady"
    spread = RECURRENCE_JITTER_STEADY if steady else RECURRENCE_JITTER_IRREGULAR
    rng = random.Random(_seed(seed_key, str(out.get("id", ""))))

    times = [start]
    gaps: list[float] = []
    while len(times) < RECURRENCE_MAX_OCCURRENCES:
        gap = max(RECURRENCE_MIN_GAP_S, mean_gap * (1.0 + spread * rng.uniform(-1.0, 1.0)))
        nxt = times[-1] + duration + gap
        if nxt + duration > end:
            break
        gaps.append(round(gap, 2))
        times.append(nxt)

    out["timestamps"] = [format_mmss(t) for t in times]
    out["copyCount"] = _clamped_copy_count(math.ceil(len(times) / RECURRENCE_OCCURRENCES_PER_COPY))
    out["recurrence"] = {
        "perMinute": round(per_minute, 3),
        "regularity": "steady" if steady else "irregular",
        "start": rec.get("start") if isinstance(rec.get("start"), str) else format_mmss(start),
        "end": format_mmss(end),
        "gaps": gaps,
    }
    return out


def recurrence_trigger(
    entry_id: str,
    recurrence: dict,
    timestamps: list,
    known_ids: set[str],
    background_ids: set[str],
) -> tuple[dict, str | None]:
    """Orchestrate trigger chain for an expanded recurring entry.

    Returns ``(trigger, warning)``. The first occurrence follows ``start`` — an
    absolute time, or a cause on another (non-background, known) sound; any other
    cause falls back to the first authored time and returns a warning. Occurrence
    k follows occurrence k-1 by its stored gap.
    """
    n = max(1, len(timestamps or []))
    gaps = list(recurrence.get("gaps") or [])
    first_hint = (timestamps or ["00:00"])[0]
    warning = None

    start = recurrence.get("start")
    cause = parse_cause(start)
    if cause is not None:
        ref_id = reference_entry_id(cause[1])
        if ref_id == entry_id or ref_id not in known_ids or ref_id in background_ids:
            warning = (
                f"recurring {entry_id!r}: cause {start!r} is not a schedulable sound — "
                f"starting at its written time {first_hint}"
            )
            first = str(first_hint)
        else:
            first = f"{cause[0]}({cause[1]})"
    elif parse_mmss(start) is not None:
        first = format_mmss(parse_mmss(start))
    else:
        first = str(first_hint)

    expression = [first]
    delay = [0.0]
    for k in range(1, n):
        expression.append(f"after({entry_id}#{k})")
        delay.append(float(gaps[k - 1]) if k - 1 < len(gaps) else RECURRENCE_MIN_GAP_S)
    trig_type = "absolute" if n == 1 and parse_cause(first) is None else (
        "mixed" if parse_cause(first) is None else "param"
    )
    return {"type": trig_type, "expression": expression, "delay": delay}, warning


def rotating_variants(count: int, copy_count: int) -> list[int]:
    """1-based copy per occurrence, rotating so neighbours differ: [1, 2, 3, 1, 2, …]."""
    copies = _clamped_copy_count(copy_count)
    return [(i % copies) + 1 for i in range(max(1, count))]
