"""Orchestrate overlap rule (code check) and the ElevenLabs foley prompt style."""

from config.constants import AUDIO_MODEL_ELEVENLABS, AUDIO_MODEL_SA3
from services.llm_service import LLMService, _enforce_overlap_policy, _measured_entry_durations

FOLEY = {
    "sounds": [
        {"id": "footsteps_1", "category": "sound event", "oneShot": False, "copyDurations": [3.0, 3.0]},
        {"id": "door_close_1", "category": "sound event", "oneShot": True, "copyDurations": [2.0]},
        {"id": "laptop_1", "category": "sound event", "oneShot": True, "copyDurations": [1.5]},
    ]
}
SPEECH = {
    "speeches": [
        {"id": "Emma_1", "character": "Emma", "timestamps": ["00:03", "00:11"],
         "lines": [{"text": "a", "durationSec": 2.5}, {"text": "b", "durationSec": 4.0}]},
        {"id": "Lucas_1", "character": "Lucas", "timestamps": ["00:05"],
         "lines": [{"text": "c", "durationSec": 1.8}]},
    ]
}


def _ctx():
    svc = LLMService.__new__(LLMService)
    return svc._build_orchestrate_passthrough(FOLEY, SPEECH), _measured_entry_durations(FOLEY, SPEECH)


def _trigger(expr: str, delay: float) -> dict:
    return {"type": "param", "expression": [expr], "delay": [delay]}


def test_overlap_on_a_sustained_sound_is_kept():
    passthrough, durations = _ctx()
    trig = _trigger("overlap(footsteps_1#1)", 1.2)
    assert _enforce_overlap_policy("laptop_1", trig, passthrough, durations) is trig


def test_overlap_on_an_impact_becomes_after():
    passthrough, durations = _ctx()
    out = _enforce_overlap_policy("footsteps_1", _trigger("overlap(door_close_1)", 0.5), passthrough, durations)
    assert out["expression"] == ["after(door_close_1)"]
    assert out["delay"] == [0.0]  # 0.5 s into a 2 s door -> right at its end


def test_speech_overlapping_a_sound_becomes_after_and_keeps_a_later_start():
    passthrough, durations = _ctx()
    out = _enforce_overlap_policy("Emma_1", _trigger("overlap(footsteps_1#1)", 4.0), passthrough, durations)
    assert out["expression"] == ["after(footsteps_1#1)"]
    assert out["delay"] == [1.0]  # was 4 s after the start of a 3 s walk


def test_speech_may_overlap_speech():
    passthrough, durations = _ctx()
    trig = _trigger("overlap(Emma_1#2)", 1.0)
    assert _enforce_overlap_policy("Lucas_1", trig, passthrough, durations) is trig


def test_speech_reference_uses_the_line_length():
    passthrough, durations = _ctx()
    out = _enforce_overlap_policy(
        "footsteps_1", _trigger("overlap(door_close_1, Emma_1#2)", 5.0), passthrough, durations,
    )
    assert out["expression"] == ["after(door_close_1, Emma_1#2)"]
    assert out["delay"] == [1.0]  # longest reference: Emma line 2 = 4 s


def test_foley_prompt_style_follows_the_audio_model():
    svc = LLMService.__new__(LLMService)
    el_rule, el_hint = svc._foley_description_rules(AUDIO_MODEL_ELEVENLABS)
    sa_rule, _ = svc._foley_description_rules(AUDIO_MODEL_SA3)
    assert "isolated SFX" in el_rule and "isolated SFX" in el_hint
    assert "2 to 10 word" in sa_rule and "isolated SFX" not in sa_rule
