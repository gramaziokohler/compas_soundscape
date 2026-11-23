# backend/tests/test_scene_edit_service.py
"""Scene edit chat agent (services/scene_edit_service.py).

* the plan is normalised against the snapshot: unknown refs dropped, values clamped,
  new refs assigned, voices restricted to the TTS characters;
* the prompts carry the scene, the history and the request;
* the agent call returns a SceneEditResult dict (LLM mocked).
"""
import asyncio

from config.constants import (
    DBFS_MIN,
    SCENE_EDIT_LEVEL_DELTA_MAX_DB,
    SCENE_EDIT_MAX_NEW_SOUNDS,
    SCENE_EDIT_MAX_VARIANTS,
    TTS_CHARACTER_NAMES,
)
from models.schemas import (
    SceneEditHistoryMessage,
    SceneEditOp,
    SceneEditPlan,
    SceneEditSnapshot,
    SceneEditSnapshotCard,
    SceneEditSnapshotObject,
)
from services.llm_service import LLMService
from services.scene_edit_service import SceneEditService, normalise_plan

ROOM = {"min": [0, 0, 0], "max": [10, 8, 3]}


def _snapshot() -> SceneEditSnapshot:
    return SceneEditSnapshot(
        title="Office morning",
        duration_s=60,
        room=ROOM,
        cards=[
            SceneEditSnapshotCard(ref="S1", kind="foley", name="HVAC hum", category="background sound"),
            SceneEditSnapshotCard(ref="S2", kind="foley", name="Footsteps", category="sound event", times_s=[3, 12]),
            SceneEditSnapshotCard(ref="S3", kind="speech", name="Sofia", character="Sofia", lines=["Hello", "Bye"]),
        ],
        objects=[SceneEditSnapshotObject(ref="O1", name="Entrance door", center=[0.1, 4, 1])],
        directivity_presets=["human_voice"],
    )


def _normalise(*ops: SceneEditOp):
    return normalise_plan(SceneEditPlan(reply="ok", ops=list(ops)), _snapshot())


def test_unknown_targets_are_dropped_with_a_warning():
    ops, warnings = _normalise(
        SceneEditOp(op="set_level", targets=["S1", "S9"], delta_db=-6),
        SceneEditOp(op="mute", targets=["S42"]),
    )
    assert [o.op for o in ops] == ["set_level"]
    assert ops[0].targets == ["S1"]
    assert any("S9" in w for w in warnings)
    assert any(w.startswith("Skipped mute") for w in warnings)


def test_levels_are_clamped():
    ops, _ = _normalise(
        SceneEditOp(op="set_level", targets=["S1"], delta_db=-100),
        SceneEditOp(op="set_level", targets=["S2"], db=-500),
        SceneEditOp(op="set_level", targets=["S2"]),
    )
    assert ops[0].delta_db == -SCENE_EDIT_LEVEL_DELTA_MAX_DB
    assert ops[1].db == DBFS_MIN and ops[1].delta_db is None
    assert len(ops) == 2


def test_times_are_sorted_deduplicated_and_inside_the_scene():
    ops, _ = _normalise(SceneEditOp(op="set_times", targets=["S2"], times_s=[90, 5, 5, -2]))
    assert ops[0].times_s == [0, 5, 60]


def test_speech_ops_only_target_speech_cards():
    ops, warnings = _normalise(SceneEditOp(op="edit_lines", targets=["S2"], lines=["x"]))
    assert ops == []
    assert warnings


def test_new_sounds_get_refs_and_later_ops_may_use_them():
    ops, warnings = _normalise(
        SceneEditOp(op="add_sound", prompt="door creak", anchor_objects=["O1", "O7"], count=9),
        SceneEditOp(op="set_level", targets=["N1"], delta_db=-3),
    )
    assert [o.op for o in ops] == ["add_sound", "set_level"]
    added = ops[0]
    assert added.new_ref == "N1"
    assert added.anchor_objects == ["O1"]
    assert added.count == SCENE_EDIT_MAX_VARIANTS
    assert added.category == "sound event"
    assert ops[1].targets == ["N1"]
    assert not warnings


def test_new_speaker_gets_a_free_valid_voice():
    ops, warnings = _normalise(
        SceneEditOp(op="add_speaker", character="Sofia", lines=["Sorry to interrupt"], times_s=[25], near="S3"),
        SceneEditOp(op="add_speaker", character="Nobody", lines=["Hi"]),
        SceneEditOp(op="add_speaker", character=TTS_CHARACTER_NAMES[0], lines=[]),
    )
    assert len(ops) == 2
    chars = [o.character for o in ops]
    assert all(c in TTS_CHARACTER_NAMES for c in chars)
    assert "Sofia" not in chars and len(set(chars)) == 2
    assert ops[0].near == "S3" and ops[0].times_s == [25]
    assert any("no lines" in w for w in warnings)


def test_new_sound_cap():
    many = [SceneEditOp(op="add_sound", prompt=f"sound {i}") for i in range(SCENE_EDIT_MAX_NEW_SOUNDS + 2)]
    ops, warnings = _normalise(*many)
    assert len(ops) == SCENE_EDIT_MAX_NEW_SOUNDS
    assert len(warnings) == 2


def test_positions_are_clamped_and_invalid_moves_dropped():
    ops, warnings = _normalise(
        SceneEditOp(op="move", targets=["S2"], position=[50, -3, 9]),
        SceneEditOp(op="move", targets=["S2"], anchor_objects=["O9"]),
    )
    assert len(ops) == 1
    x, y, z = ops[0].position
    assert 0 < x <= 10 and 0 < y < 8 and z == 3
    assert any(w.startswith("Skipped move") for w in warnings)


def test_variants_directivity_trim_and_voice():
    ops, warnings = _normalise(
        SceneEditOp(op="set_variants", targets=["S2"], count=3),
        SceneEditOp(op="set_directivity", targets=["S3"], preset="trumpet"),
        SceneEditOp(op="set_directivity", targets=["S3"], preset="human_voice"),
        SceneEditOp(op="trim", targets=["S2"], start=0.8, end=0.2),
        SceneEditOp(op="change_voice", targets=["S3"], character=TTS_CHARACTER_NAMES[1].upper()),
    )
    assert [o.op for o in ops] == ["set_variants", "set_directivity", "change_voice"]
    assert ops[0].count == 3
    assert ops[2].character == TTS_CHARACTER_NAMES[1]
    assert len(warnings) == 2


def test_prompts_carry_scene_history_and_request():
    history = [SceneEditHistoryMessage(role="user", text="make it busier")]
    system, user = SceneEditService.build_prompts(_snapshot(), history, "Add a third speaker at 0:25")
    assert "interruption" in system.lower()
    assert '"ref": "S3"' in user
    assert "USER: make it busier" in user
    assert "Add a third speaker at 0:25" in user
    assert "x from 0.00 to 10.00" in user


def test_plan_edit_returns_a_normalised_result():
    class _FakeLLM:
        async def _call_llm(self, user_prompt, system_prompt, **kwargs):
            assert kwargs["response_schema"] is SceneEditPlan
            return {
                "reply": "Lowered the hum. ",
                "ops": [{"op": "set_level", "targets": ["S1", "S5"], "delta_db": -6}],
            }

    service = SceneEditService(_FakeLLM())  # type: ignore[arg-type]
    result = asyncio.run(service.plan_edit(_snapshot(), [], "the hum is too loud"))
    assert result["kind"] == "scene_edit"
    assert result["reply"] == "Lowered the hum."
    assert result["ops"][0]["targets"] == ["S1"]
    assert result["warnings"]


def test_plan_schema_is_flat_for_structured_output():
    schema = LLMService._to_json_schema(SceneEditPlan)
    op = schema["$defs"]["SceneEditOp"]
    assert op["additionalProperties"] is False
    assert "discriminator" not in str(schema)
