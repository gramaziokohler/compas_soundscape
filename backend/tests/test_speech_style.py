"""Speech delivery style: level bands, orchestrate clamp, TTS annotation, scene-edit proposal."""
from config.constants import SPEECH_DBFS_DEFAULT, SPEECH_DBFS_MAX, SPEECH_DBFS_MIN, TTS_CHARACTER_NAMES
from models.schemas import SceneEditOp, SceneEditPlan, SceneEditSnapshot
from services.llm_service import _entry_spl
from services.scene_edit_service import normalise_plan
from services.tts_service import TTSService
from utils.speech_style import clean_style, proposed_speech_dbfs, speech_dbfs_band, style_level


def test_style_level_matches_keywords():
    assert style_level("Whispering softly")["key"] == "whisper"
    assert style_level("shouting across the hall")["key"] == "shout"
    assert style_level("tired and slow")["key"] == "soft"
    assert style_level("excited and fast") is None
    assert style_level("") is None


def test_neutral_style_keeps_normal_speech_band():
    assert speech_dbfs_band("") == (SPEECH_DBFS_MIN, SPEECH_DBFS_MAX, SPEECH_DBFS_DEFAULT)
    assert proposed_speech_dbfs("excited") is None


def test_whisper_is_quieter_and_shout_louder_than_talk():
    assert proposed_speech_dbfs("whisper") < SPEECH_DBFS_DEFAULT < proposed_speech_dbfs("shout")


def test_clean_style_collapses_and_truncates():
    assert clean_style("  a \n b  ") == "a b"
    assert len(clean_style("x" * 1000)) == 200


def test_orchestrate_clamps_speech_to_style_band():
    lo, hi, default = speech_dbfs_band("whispering")
    # The LLM left a whisper at normal talk level: pulled down into the whisper band.
    assert _entry_spl("-18 dBFS", "speech", "whispering") == f"{hi:g} dBFS"
    # No level at all: the band default is proposed.
    assert _entry_spl("", "speech", "whispering") == f"{default:g} dBFS"
    # Neutral speech keeps the old band.
    assert _entry_spl("-30 dBFS", "speech", "") == f"{SPEECH_DBFS_MIN:g} dBFS"
    # Foley ignores style.
    assert _entry_spl("-20 dBFS", "sound event", "whispering") == "-20 dBFS"


def test_tts_content_annotates_style_over_whole_text():
    text = "Café ouvert"
    content = TTSService._text_content(text, " whispering ")
    assert content["text"] == text
    (note,) = content["annotations"]
    assert note == {"type": "speech_metadata", "style": "whispering", "start_index": 0,
                    "end_index": len(text.encode("utf-8"))}
    assert "annotations" not in TTSService._text_content(text, "")


def _snapshot() -> SceneEditSnapshot:
    return SceneEditSnapshot.model_validate({
        "duration_s": 60,
        "cards": [{"ref": "S1", "kind": "speech", "name": "Clara", "character": TTS_CHARACTER_NAMES[0],
                   "lines": ["Hi"]}],
        "objects": [],
        "room": None,
    })


def test_scene_edit_proposes_level_for_style():
    free = TTS_CHARACTER_NAMES[1]
    plan = SceneEditPlan(reply="ok", ops=[
        SceneEditOp(op="set_style", targets=["S1"], style="whispering"),
        SceneEditOp(op="set_style", targets=["S1"], style="shouting", db=-14),
        SceneEditOp(op="add_speaker", character=free, lines=["Hey!"], position=[1, 1, 1.6], style="yelling"),
        SceneEditOp(op="add_speaker", character=TTS_CHARACTER_NAMES[2], lines=["Hi"], position=[1, 1, 1.6]),
    ])
    ops, _ = normalise_plan(plan, _snapshot())
    assert [o.op for o in ops] == ["set_style", "set_style", "add_speaker", "add_speaker"]
    assert ops[0].db == proposed_speech_dbfs("whispering")
    assert ops[1].db == -14  # the agent's own level wins
    assert ops[2].db == proposed_speech_dbfs("yelling")
    assert ops[3].db is None  # neutral new speaker: orchestration sets the level
