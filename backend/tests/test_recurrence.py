# backend/tests/test_recurrence.py
"""Recurring foley activities and orchestrate robustness.

* an ongoing activity (`recurrence`) is spread over its window with seeded gaps:
  same input → same rhythm, steady gaps vary less than irregular ones, the count
  is capped, the copy count follows the occurrence count, nothing overlaps itself;
* the orchestrate merge chains its occurrences (`after(<self>#k)`) from a start
  time or a cause sound, and falls back to the written time for an unusable cause;
* entries the LLM omits are kept at their written times, levels are clamped to
  their category band, bed references are stripped, and a scene-edit request
  reaches the re-orchestration prompt.
"""

import statistics

from config.constants import (
    EVENT_DBFS_MAX,
    MAX_SEED_COPIES,
    RECURRENCE_MAX_OCCURRENCES,
    RECURRENCE_MIN_GAP_S,
    SPEECH_DBFS_MIN,
)
from services.llm_service import LLMService, _sanitize_trigger_refs
from utils.recurrence import expand_recurrence, parse_mmss, recurrence_trigger


def _service() -> LLMService:
    # Prompt builders and the merge need no LLM client.
    return LLMService.__new__(LLMService)


def _page_turns(regularity: str = "irregular", per_minute: float = 2, start: str = "00:00") -> dict:
    return {
        "id": "page_turn_1", "soundName": "page turn", "description": "paper page turned",
        "category": "sound event", "duration": "00:01", "timestamps": ["00:03"], "copyCount": 1,
        "objectsInvolved": [], "position": [0, 0, 0.8],
        "recurrence": {"perMinute": per_minute, "regularity": regularity, "start": start, "end": ""},
    }


def _occurrence_gaps(entry: dict) -> list[float]:
    return list(entry["recurrence"]["gaps"])


def test_expansion_is_reproducible_and_fills_the_window():
    a = expand_recurrence(_page_turns(per_minute=6), 120, "scenario-a")
    b = expand_recurrence(_page_turns(per_minute=6), 120, "scenario-a")
    assert a["timestamps"] == b["timestamps"] and a["recurrence"]["gaps"] == b["recurrence"]["gaps"]
    # About 6/min over 2 min, minus jitter; the last occurrence fits in the scene.
    assert 6 <= len(a["timestamps"]) <= 18
    assert parse_mmss(a["timestamps"][-1]) + 1 <= 120
    assert len(a["recurrence"]["gaps"]) == len(a["timestamps"]) - 1


def test_steady_rhythm_varies_less_than_irregular():
    steady = _occurrence_gaps(expand_recurrence(_page_turns("steady", 6), 300, "s"))
    irregular = _occurrence_gaps(expand_recurrence(_page_turns("irregular", 6), 300, "s"))
    assert statistics.pstdev(steady) < statistics.pstdev(irregular)


def test_irregular_gaps_include_long_pauses_and_a_late_first_occurrence():
    entry = expand_recurrence(_page_turns("irregular", 6, start="00:10"), 600, "pauses")
    gaps = _occurrence_gaps(entry)
    mean = statistics.mean(gaps)
    # Log-normal spread: some gaps well above and some well below the mean.
    assert max(gaps) > 1.6 * mean and min(gaps) < 0.6 * mean
    # Not exactly on its cue: the first occurrence lags the start by firstDelay.
    assert entry["recurrence"]["firstDelay"] > 0
    assert parse_mmss(entry["timestamps"][0]) >= 10


def test_cause_chain_carries_the_first_delay():
    entry = expand_recurrence(_page_turns(start="after(chair_sit_1#1)", per_minute=6), 60, "x")
    trigger, _ = recurrence_trigger(
        "page_turn_1", entry["recurrence"], entry["timestamps"], {"chair_sit_1", "page_turn_1"}, set(),
    )
    assert trigger["delay"][0] == entry["recurrence"]["firstDelay"]


def test_occurrences_are_capped_and_never_overlap():
    entry = expand_recurrence(_page_turns(per_minute=600), 600, "busy")
    assert len(entry["timestamps"]) == RECURRENCE_MAX_OCCURRENCES
    assert all(gap >= RECURRENCE_MIN_GAP_S for gap in entry["recurrence"]["gaps"])
    assert entry["copyCount"] == MAX_SEED_COPIES


def test_copy_count_follows_occurrences_and_liveliness_scales_rate():
    calm = expand_recurrence(_page_turns(per_minute=2), 60, "x", rate_multiplier=0.5)
    lively = expand_recurrence(_page_turns(per_minute=2), 60, "x", rate_multiplier=3.0)
    assert len(calm["timestamps"]) < len(lively["timestamps"])
    assert calm["copyCount"] == 1 and lively["copyCount"] >= 2


def test_non_recurring_entry_only_gets_its_copy_count_clamped():
    entry = expand_recurrence({"id": "door_1", "timestamps": ["00:04"], "copyCount": 9}, 60, "x")
    assert entry["timestamps"] == ["00:04"] and entry["copyCount"] == MAX_SEED_COPIES


def test_trigger_chain_follows_a_cause():
    entry = expand_recurrence(_page_turns(start="after(chair_sit_1#1)", per_minute=6), 60, "x")
    trigger, warning = recurrence_trigger(
        "page_turn_1", entry["recurrence"], entry["timestamps"], {"chair_sit_1", "page_turn_1"}, set(),
    )
    assert warning is None
    assert trigger["expression"][0] == "after(chair_sit_1#1)"
    assert trigger["expression"][1:] == [f"after(page_turn_1#{k})" for k in range(1, len(entry["timestamps"]))]
    assert trigger["delay"][1:] == entry["recurrence"]["gaps"]


def test_unusable_cause_falls_back_to_the_written_time():
    entry = expand_recurrence(_page_turns(start="after(rain_bed_1#1)", per_minute=6), 60, "x")
    trigger, warning = recurrence_trigger(
        "page_turn_1", entry["recurrence"], entry["timestamps"], {"rain_bed_1", "page_turn_1"}, {"rain_bed_1"},
    )
    assert warning and trigger["expression"][0] == entry["timestamps"][0]


def test_merge_chains_recurring_entries_and_keeps_omitted_ones():
    page = expand_recurrence(_page_turns(per_minute=6), 60, "x")
    foley = {"sounds": [
        page,
        {"id": "door_1", "soundName": "door", "description": "door", "category": "sound event",
         "timestamps": ["00:10", "00:40"], "copyCount": 2, "objectsInvolved": [], "position": [1, 1, 1]},
        {"id": "tap_1", "soundName": "tap", "description": "tap", "category": "sound event",
         "timestamps": ["00:05"], "copyCount": 1, "objectsInvolved": [], "position": [1, 1, 1]},
    ]}
    speech = {"speeches": [
        {"id": "Ana_1", "character": "Ana", "script": "Hi; Bye", "timestamps": ["00:01", "00:20"],
         "position": [0, 0, 1.5]},
    ]}
    llm = {"playlist": [
        # The LLM tries to re-time the recurring entry: ignored, only its level is used.
        {"id": "page_turn_1", "trigger": {"type": "absolute", "expression": ["00:00"], "delay": [0]},
         "variants": [1], "spl": "-22 dBFS"},
        {"id": "tap_1", "trigger": {"type": "absolute", "expression": ["00:05"], "delay": [0]},
         "variants": [1], "spl": "-3 dBFS"},
        {"id": "Ana_1", "trigger": {"type": "param", "expression": ["00:01", "after(Ana_1#1)"], "delay": [0, 0]},
         "variants": [1, 2], "spl": "-40 dBFS"},
    ]}
    merged = {e["id"]: e for e in _service()._merge_orchestrate_playlist(llm, foley, speech)["playlist"]}

    chain = merged["page_turn_1"]["trigger"]["expression"]
    assert len(chain) == len(page["timestamps"]) and chain[1] == "after(page_turn_1#1)"
    assert merged["page_turn_1"]["recurrence"]["gaps"] == page["recurrence"]["gaps"]
    # Omitted by the LLM → kept at its written times, not dropped.
    assert merged["door_1"]["trigger"]["expression"] == ["00:10", "00:40"]
    assert merged["door_1"]["variants"] == [1, 2]
    # Levels clamped to their category band.
    assert merged["tap_1"]["spl"] == f"{EVENT_DBFS_MAX:g} dBFS"
    assert merged["Ana_1"]["spl"] == f"{SPEECH_DBFS_MIN:g} dBFS"


def test_bed_references_are_stripped_from_triggers():
    trigger = {"type": "param", "expression": ["overlap(cafe_ambience_1#1)"], "delay": [0.5]}
    cleaned = _sanitize_trigger_refs(trigger, {"cafe_ambience_1"}, ["00:04"])
    assert cleaned["expression"] == ["00:04"]


def test_scene_edit_request_reaches_the_reorchestration_prompt():
    _, prompt = _service()._build_orchestrate_prompts(
        "{}", "{}", "{}", mode="reorchestrate", edit_instruction="make Louis interrupt Clara",
    )
    assert "make Louis interrupt Clara" in prompt
