# backend/tests/test_scenario_spatial.py
"""Room extents and people handling of the scenario agents (scenarist / foley / speech).

* the room the agents place sounds in follows the precedence model analysis > request bounds >
  room size the scenarist read from the prompt ("a room of 8x10x4") > virtual room;
* LLM-guessed positions are clamped inside the room (horizontal margin, floor to ceiling);
* without a people count the scenarist infers the people, and with the virtual room it may
  replace it by a size the prompt states;
* the foley and speech prompts carry the readable extents and the placement rules;
* a background bed with a location (window, vent…) keeps its `spatial` flag through orchestration.
"""

from models.schemas import FoleyArtistRequest, Scenario, ScenaristStreamRequest
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


def test_scenario_and_foley_prompts_carry_the_realism_rules():
    svc = _service()
    _, scenario = svc._build_scenarist_prompts(None, "{}", 60, 3, 9, has_furniture=False, liveliness="lively")
    assert "Nobody Freezes" in scenario and "Behaviour Over Decor" in scenario
    assert "Outside World" in scenario and "Atmosphere: Lively" in scenario
    _, foley = svc._build_foley_prompts("{}", "{}", "balanced", liveliness="calm")
    for rule in ("LISTEN BETWEEN THE LINES", "RECURRING ACTIVITIES", "VENUE SOURCES", '"recurrence"'):
        assert rule in foley
    assert "at most one off-screen venue source" in foley
    # Backgrounds are specific noise sources, never a generic "room tone".
    assert "SPECIFIC, nameable noise sources" in foley and "distant motorcycle" in foley


def test_foley_prompt_picks_crowd_voices_from_the_catalogue():
    svc = _service()
    _, with_list = svc._build_foley_prompts(
        "{}", "{}", "balanced", crowd_catalog=["Crowd Talking", "Voices Murmur", "Team Cheer"],
    )
    assert "CROWD VOICES" in with_list and '"Voices Murmur"' in with_list and '"Team Cheer"' in with_list
    assert "Voices On Street Accent" in with_list  # outdoor preference
    _, without = svc._build_foley_prompts("{}", "{}", "balanced")
    assert "(none available)" in without
    assert FoleyArtistRequest(scenario_id="s", crowd_catalog=["Crowd Talking"]).crowd_catalog == ["Crowd Talking"]


def test_speech_prompt_scales_social_density():
    svc = _service()
    scenarios = [{"duration": "1:00", "peopleCount": 8, "peopleDescription": "8 friends"}]
    _, calm = svc._build_speech_prompts("{}", liveliness="calm", scenarios=scenarios)
    _, lively = svc._build_speech_prompts("{}", liveliness="lively", scenarios=scenarios)
    assert "SOCIAL SCENES" in lively and "The scene has 8 people (8 friends)" in lively
    # 2 vs 5 lines per speaker per 30 s over a 60 s scene.
    assert "about 4 lines per speaker" in calm and "about 10 lines per speaker" in lively


def test_schema_defaults():
    scenario = Scenario(title="t", duration="1:00", peopleCount=5, likeliness=9, events=[])
    assert scenario.hasSpeech and scenario.roomDimensions == [] and scenario.peopleDescription == ""
    assert ScenaristStreamRequest().people_count is None


def test_spatial_background_flag_survives_orchestration():
    svc = _service()
    _, prompt = svc._build_foley_prompts("{}", "{}", "balanced")
    assert '"spatial"' in prompt
    foley = {"sounds": [
        {"id": "traffic_1", "soundName": "traffic", "category": "background sound", "spatial": True,
         "position": [3.8, 0, 1.5], "timestamps": ["00:00"]},
        {"id": "room_tone_1", "soundName": "room tone", "category": "background sound",
         "position": [0, 0, 1.5], "timestamps": ["00:00"]},
    ]}
    llm = {"playlist": [
        {"id": sid, "trigger": {"type": "absolute", "expression": ["00:00"], "delay": [0]},
         "variants": [1], "spl": "50 dB"}
        for sid in ("traffic_1", "room_tone_1")
    ]}
    playlist = svc._merge_orchestrate_playlist(llm, foley, {"speeches": []})["playlist"]
    spatial = {e["id"]: e["spatial"] for e in playlist}
    assert spatial == {"traffic_1": True, "room_tone_1": False}
