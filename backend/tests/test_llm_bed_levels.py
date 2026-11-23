"""Background-bed levels: prompt guidance + clamping of LLM-proposed levels."""

from config.constants import (
    BACKGROUND_BED_DBFS_DEFAULT,
    BACKGROUND_BED_DBFS_MAX,
    BACKGROUND_BED_DBFS_MIN,
)
from services.llm_service import LLMService, _bed_dbfs, _bed_spl


def _service() -> LLMService:
    # The helpers under test only use static data, not the LLM clients.
    return LLMService.__new__(LLMService)


def test_bed_level_is_clamped_to_the_bed_band():
    assert _bed_dbfs(-24.0) == BACKGROUND_BED_DBFS_MAX
    assert _bed_dbfs(-70.0) == BACKGROUND_BED_DBFS_MIN
    assert _bed_dbfs(-40.0) == -40.0
    assert _bed_dbfs(None) == BACKGROUND_BED_DBFS_DEFAULT


def test_bed_spl_string():
    assert _bed_spl("-24 dBFS") == f"{BACKGROUND_BED_DBFS_MAX:g} dBFS"
    assert _bed_spl("-40") == "-40 dBFS"
    assert _bed_spl("") == f"{BACKGROUND_BED_DBFS_DEFAULT:g} dBFS"


def test_sound_list_continuous_context_sound_gets_a_bed_level():
    parsed = _service()._parse_prompt_and_name(
        "PROMPT: Cafe interior room tone, seamless loop\nNAME: Cafe Ambience\nSPL: -24\n"
        "INTERVAL: 0\nDURATION: 30.0\nENTITY: NONE"
    )
    assert parsed["dbfs"] == BACKGROUND_BED_DBFS_MAX


def test_sound_list_events_and_entity_loops_keep_their_level():
    svc = _service()
    event = svc._parse_prompt_and_name(
        "PROMPT: Cup set on saucer\nNAME: Cup\nSPL: -24\nINTERVAL: 20\nDURATION: 0.8\nENTITY: NONE"
    )
    entity_loop = svc._parse_prompt_and_name(
        "PROMPT: Espresso machine hum\nNAME: Espresso Machine\nSPL: -24\nINTERVAL: 0\nDURATION: 20.0\nENTITY: 2"
    )
    assert event["dbfs"] == -24.0
    assert entity_loop["dbfs"] == -24.0


def test_orchestrate_merge_clamps_and_fills_bed_levels():
    foley = {"sounds": [
        {"id": "bed_1", "category": "background sound", "timestamps": ["00:00"]},
        {"id": "bed_2", "category": "background", "timestamps": ["00:00"]},
        {"id": "cup_1", "category": "sound event", "timestamps": ["00:05"]},
    ]}
    llm = {"playlist": [
        {"id": "bed_1", "spl": "-24 dBFS"},
        {"id": "cup_1", "spl": "-24 dBFS", "trigger": {"type": "absolute", "expression": ["00:05"], "delay": [0.0]},
         "variants": [1]},
    ]}
    merged = {e["id"]: e for e in _service()._merge_orchestrate_playlist(llm, foley, {})["playlist"]}
    assert merged["bed_1"]["spl"] == f"{BACKGROUND_BED_DBFS_MAX:g} dBFS"
    assert merged["bed_2"]["spl"] == f"{BACKGROUND_BED_DBFS_DEFAULT:g} dBFS"  # LLM gave none
    assert merged["cup_1"]["spl"] == "-24 dBFS"


def test_prompts_quote_the_bed_band():
    svc = _service()
    band = f"{BACKGROUND_BED_DBFS_MIN:g} to {BACKGROUND_BED_DBFS_MAX:g} dBFS"
    assert band in svc._create_base_sound_prompt("a busy cafe", 5)
    _, user_prompt = svc._build_orchestrate_prompts("{}", "{}", "{}")
    assert band in user_prompt
