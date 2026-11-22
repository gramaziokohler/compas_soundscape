# backend/tests/test_scenario_spatial.py
"""Room extents and people handling of the scenario agents (scenarist / foley / speech).

* the room the agents place sounds in follows the precedence model analysis > request bounds >
  room size the scenarist read from the prompt ("a room of 8x10x4") > virtual room;
* LLM-guessed positions are clamped inside the room (horizontal margin, floor to ceiling);
* without a people count the scenarist infers the people, and with the virtual room it may
  replace it by a size the prompt states;
* the foley and speech prompts carry the readable extents and the placement rules.
"""

from models.schemas import Scenario, ScenaristStreamRequest
from routers.generation import _load_furniture_list
from services.llm_service import LLMService
from utils.spatial import clamp_position, scenario_room_bounds

MARGIN = 0.2
STATED_ROOM = {"scenarios": [{"roomDimensions": [8, 10, 4]}]}


def _service() -> LLMService:
    # Prompt builders need no LLM client.
    return LLMService.__new__(LLMService)


def test_room_from_prompt_replaces_virtual_room():
    meta = _load_furniture_list(None, None, STATED_ROOM)["meta"]
    assert meta["room_source"] == "scenario"
    assert meta["total_bounds"]["min"] == [-4, -5, 0]
    assert meta["total_bounds"]["max"] == [4, 5, 4]


def test_room_precedence_and_fallbacks():
    assert _load_furniture_list(None, None, None)["meta"]["room_source"] == "default"
    implausible = {"scenarios": [{"roomDimensions": [0.1, 10, 4]}]}
    assert _load_furniture_list(None, None, implausible)["meta"]["room_source"] == "default"
    live = {"min": [0, 0, 0], "max": [20, 30, 5]}
    assert _load_furniture_list(None, live, STATED_ROOM)["meta"]["room_source"] == "request"
    assert scenario_room_bounds({"scenarios": [{"roomDimensions": []}]}) is None


def test_clamp_position():
    bounds = _load_furniture_list(None, None, STATED_ROOM)["meta"]["total_bounds"]
    assert clamp_position([10, -9, 7], bounds, MARGIN) == [3.8, -4.8, 4.0]
    assert clamp_position([1, 2, 0.05], bounds, MARGIN) == [1.0, 2.0, 0.05]
    assert clamp_position(["a", 1, 2], bounds, MARGIN) == []
    assert clamp_position([1, 2, 3], None, MARGIN) == [1.0, 2.0, 3.0]


def test_entry_positions_clamped_and_linked_left_empty():
    furniture = _load_furniture_list(None, None, STATED_ROOM)
    entries = [{"position": [99, 0, 1.6]}, {"position": []}]
    LLMService._clamp_entry_positions(entries, furniture)
    assert entries == [{"position": [3.8, 0.0, 1.6]}, {"position": []}]


def test_scenarist_prompt_infers_people_and_room():
    svc = _service()
    fc, has_furniture, extents, is_default = svc._scenarist_furniture_context(
        _load_furniture_list(None, None, None)
    )
    assert is_default and extents and not has_furniture
    _, inferred = svc._build_scenarist_prompts(
        "a room of 8x10x4, 2 people and 3 children", fc, 60, None, 9,
        has_furniture=has_furniture, room_bounds=extents, room_is_default=is_default,
    )
    assert "infer it" in inferred and "ASSUMED default room" in inferred
    assert "hasSpeech" in inferred and "roomDimensions" in inferred

    _, fixed = svc._build_scenarist_prompts(None, fc, 60, 4, 9, has_furniture=False, room_bounds=extents)
    assert "People Count: 4" in fixed and "fixed by the 3D model" in fixed


def test_foley_and_speech_prompts_carry_room_extents():
    svc = _service()
    extents = svc._room_extents(_load_furniture_list(None, None, STATED_ROOM))
    _, foley = svc._build_foley_prompts("{}", "{}", "balanced", room_extents=extents)
    _, speech = svc._build_speech_prompts("{}", "{}", language="French", room_extents=extents)
    for prompt in (foley, speech):
        assert "SPATIAL PLACEMENT" in prompt and "width 8.00 m" in prompt


def test_schema_defaults():
    scenario = Scenario(title="t", duration="1:00", peopleCount=5, likeliness=9, events=[])
    assert scenario.hasSpeech and scenario.roomDimensions == [] and scenario.peopleDescription == ""
    assert ScenaristStreamRequest().people_count is None
