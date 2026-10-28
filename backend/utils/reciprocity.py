"""
Acoustic reciprocity for the pyroomacoustics pipeline.

A simulation runs once per *emitter* (image sources + ray tracing from one
point, with every counterpart as a microphone), so its cost grows with the number
of emitters. By reciprocity the impulse response from A to B equals the one from
B to A, so when there are more sources than listeners the roles are swapped:
each listener becomes the emitter and the sources become its microphones.

The swap is only used where it is exact and cheaper:

* mono listeners — a first-order (FOA) listener is four directional microphones
  that share one ray-traced receiver, but as an emitter it would be four
  sources, so swapping never pays;
* omnidirectional sources — a source pattern would have to become a microphone pattern.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from config.constants import PYROOMACOUSTICS_SIMULATION_MODE_MONO


@dataclass(frozen=True)
class ReciprocityDecision:
    flipped: bool
    reason: str
    n_sources: int
    n_receivers: int

    def as_dict(self) -> dict:
        return {
            "flipped": self.flipped,
            "reason": self.reason,
            "n_sources": self.n_sources,
            "n_receivers": self.n_receivers,
        }


def decide_reciprocity(pairs: list[dict], simulation_mode: str, enabled: bool = True) -> ReciprocityDecision:
    """Whether the listeners should emit (True) or the sources (False)."""
    n_sources = len({str(p["source_id"]) for p in pairs})
    n_receivers = len({str(p["receiver_id"]) for p in pairs})

    def keep(reason: str) -> ReciprocityDecision:
        return ReciprocityDecision(False, reason, n_sources, n_receivers)

    if not enabled:
        return keep("disabled")
    if simulation_mode != PYROOMACOUSTICS_SIMULATION_MODE_MONO:
        return keep("ambisonic listeners are not swapped")
    if any(p.get("source_directivity_spec") for p in pairs):
        return keep("directional sources are not swapped")
    if n_sources <= n_receivers:
        return keep("not more sources than listeners")
    return ReciprocityDecision(
        True, f"{n_sources} sources > {n_receivers} listeners: listeners emit", n_sources, n_receivers
    )


def group_pairs_by_emitter(pairs: list[dict], flipped: bool) -> dict[str, list[dict]]:
    """Pairs grouped by the point that emits (source id, or listener id when swapped), in first-seen order."""
    key = "receiver_id" if flipped else "source_id"
    groups: dict[str, list[dict]] = defaultdict(list)
    for pair in pairs:
        groups[pair[key]].append(pair)
    return dict(groups)
