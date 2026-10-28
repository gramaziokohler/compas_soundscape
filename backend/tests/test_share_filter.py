"""
Unit tests for services/share_service.py filter_soundscape (public share
redaction). No DB / Redis needed.

Run: pytest backend/tests/test_share_filter.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from models.schemas import SoundscapeData  # noqa: E402
from services.share_service import filter_soundscape  # noqa: E402


def _ir(filename):
    return {
        "id": filename, "url": f"/x/{filename}", "filename": filename, "name": filename,
        "format": "mono", "channels": 1, "original_channels": 1, "sample_rate": 48000,
        "duration": 1.0, "file_size": 1,
    }


def source_data() -> dict:
    """Context 0, shared scene 1, private scene 2; two listeners, two sims."""
    return {
        "model_id": "m1",
        "auth_token": "FULL-ACCESS",
        "analysis_state": {
            "active_tab": 0,
            "configs": [
                {"type": "model-analysis", "display_name": "Ctx", "analysisResult": {
                    "analysisId": "a", "architecturalObjects": [{"name": "secret"}], "spaceTitle": "Hall"}},
                {"type": "text", "scene_id": "s-pub", "textInput": "public prompt", "parentContextOriginalIndex": 0},
                {"type": "text", "scene_id": "s-priv", "textInput": "private prompt", "parentContextOriginalIndex": 0},
            ],
        },
        "sound_configs": [
            {"index": 0, "config_id": "c0", "prompt": "birds", "parent_usage_original_index": 1,
             "directivity": {"id": "d1"}},
            {"index": 1, "config_id": "c1", "prompt": "secret sound", "parent_usage_original_index": 2},
        ],
        "sound_events": [
            {"id": "e0", "config_id": "c0", "prompt_index": 0, "audio_filename": "a0.wav", "position": [0, 0, 0]},
            {"id": "e1", "config_id": "c1", "prompt_index": 1, "audio_filename": "a1.wav", "position": [0, 0, 0]},
            {"id": "e2", "prompt_index": 10001, "audio_filename": "a2.wav", "position": [0, 0, 0]},
        ],
        "receivers": [
            {"id": "r-pub", "name": "L1", "position": [0, 0, 0]},
            {"id": "r-priv", "name": "L2", "position": [1, 0, 0]},
        ],
        "selected_receiver_id": "r-priv",
        "simulation_configs": [
            {"id": "sim-pub", "display_name": "S1", "type": "pyroomacoustics",
             "source_receiver_ir_mapping": {"p0": {"r-pub": _ir("ir-pub.wav"), "r-priv": _ir("ir-priv.wav")}}},
            {"id": "sim-priv", "display_name": "S2", "type": "pyroomacoustics",
             "source_receiver_ir_mapping": {"p0": {"r-pub": _ir("ir-other.wav")}}},
        ],
        "share_config": {
            "sceneIds": ["s-pub"],
            "simulationIds": ["sim-pub"],
            "listenerIds": ["r-pub"],
            "links": [
                {"id": "l1", "sceneId": "s-pub", "simulationId": "sim-pub", "listenerId": "r-pub"},
                {"id": "l2", "sceneId": "s-priv"},
            ],
        },
    }


def test_only_shared_items_and_media_survive():
    out, audio, irs = filter_soundscape(source_data())
    SoundscapeData(**out)  # still a valid payload

    assert [r["id"] for r in out["receivers"]] == ["r-pub"]
    assert out["selected_receiver_id"] is None
    assert [s["id"] for s in out["simulation_configs"]] == ["sim-pub"]
    assert list(out["simulation_configs"][0]["source_receiver_ir_mapping"]["p0"]) == ["r-pub"]
    assert [e["id"] for e in out["sound_events"]] == ["e0"]
    assert audio == {"a0.wav"}
    assert irs == {"ir-pub.wav"}
    assert [link["id"] for link in out["share_config"]["links"]] == ["l1"]


def test_private_content_and_tokens_are_redacted():
    out, _, _ = filter_soundscape(source_data())
    text = repr(out)
    assert "private prompt" not in text
    assert "secret sound" not in text
    assert "secret" not in repr(out["analysis_state"]["configs"][0])
    assert out["auth_token"] != "FULL-ACCESS"
    assert "directivity" not in out["sound_configs"][0]

    configs = out["analysis_state"]["configs"]
    assert len(configs) == 3  # indices preserved
    assert configs[2]["share_hidden"] is True
    assert configs[1]["textInput"] == "public prompt"
    assert out["sound_configs"][1]["parent_usage_original_index"] == 2
