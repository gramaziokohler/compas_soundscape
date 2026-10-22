"""
Unit tests for services/scene_transfer_core.py (scene transfer merge logic),
services/scene_transfer_service.py (in-app send + audio planning) and the admin
CLI scripts/transfer_scenes.py. No DB / Redis needed.

Run: pytest backend/tests/test_transfer_scenes.py
"""
from __future__ import annotations

import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))  # transfer_scenes CLI

from models.schemas import SoundscapeData  # noqa: E402
from services.scene_transfer_core import (  # noqa: E402
    PROMPT_INDEX_BASE,
    apply_audio_renames,
    extract_package,
    list_scenes,
    merge_package,
    package_analysis_files,
    package_audio_files,
    rekey_event_id,
)


def _ids():
    counter = itertools.count()
    return lambda: f"new-{next(counter)}"


def _sound(index, cid, parent, entity=True):
    sc = {"index": index, "config_id": cid, "prompt": f"p{index}", "parent_usage_original_index": parent}
    if entity:
        sc.update(entity_index=7, entity_indices=[7], entity_node_id="obj-a", entity_node_ids=["obj-a"])
    return sc


def _event(eid, cid, pi, audio):
    return {
        "id": eid, "config_id": cid, "prompt_index": pi, "audio_filename": audio,
        "position": [5.0, 6.0, 7.0], "entity_index": 7, "entity_indices": [7],
    }


def source_data() -> dict:
    """Context card 0 with 3 scenes (1 scenario, 2 text, 3 text) and one loose sound."""
    return {
        "model_id": "model-a", "model_name": "Office", "auth_token": "SECRET-A",
        "analysis_state": {
            "active_tab": 0,
            "configs": [
                {"type": "model-analysis", "analysisResult": {"analysisId": "an1", "architecturalObjects": [{"name": "x"}]}},
                {"type": "scenario", "parentContextOriginalIndex": 0, "display_name": "Morning", "scenarioId": "sc1",
                 "sound_config_indices": [0, 1]},
                {"type": "text", "parentContextOriginalIndex": 0, "textInput": "Rain",
                 "drawnArea": {"points": [[0, 0]]}, "sound_config_indices": [2],
                 "prompts": [{"id": "p", "text": "t", "selected": True, "entities": [{"id": "obj-a"}], "position": [1, 2, 3]}]},
                {"type": "text", "textInput": "Birds", "sound_config_indices": [3]},
            ],
            "card_flow": {"contextAdvanced": [0], "usageAdvanced": [1, 2, 3],
                          "contextToUsageMap": {"0": [1, 2]}, "usageToSoundMap": {"1": [0, 1], "2": [2], "3": [3]}},
        },
        "sound_configs": [
            _sound(0, "cid_a0", 1), _sound(1, "cid-a1", 1), _sound(2, "cid-a2", 2),
            _sound(3, "cid-a3", 3), _sound(4, "cid-a4", None, entity=False),
        ],
        "sound_events": [
            _event("generated_cid-a0_0", "cid_a0", 0, "a0.wav"),
            _event("generated_cid-a0_1", "cid_a0", 0, "a0b.wav"),
            _event("tts_cid-a1_0_Kore", "cid-a1", 1 * PROMPT_INDEX_BASE + 2, "speech.wav"),
            _event("generated_2_0", None, 2, "rain.wav"),  # legacy index-keyed id
            _event("uploaded_cid-a3_0", "cid-a3", 3, "birds.wav"),
            _event("library_cid-a4_0", "cid-a4", 4, "loose.wav"),
        ],
        "iteration_links": {"generated_cid-a0_0-1": {"variantIndex": 1, "entityNodeId": "obj-a", "entityIndex": 7}},
        "iteration_trims": {"generated_2_0-0": {"start": 0.1, "end": 0.9}},
        "excluded_iterations": {"tts_cid-a1_0_Kore": [2]},
        "muted_sounds": ["uploaded_cid-a3_0"],
        "soloed_sounds": ["generated_cid-a0_1"],
    }


def target_data() -> dict:
    """B's project: one text scene with one sound."""
    return {
        "model_id": "model-b", "model_name": "Lobby", "auth_token": "SECRET-B",
        "analysis_state": {"active_tab": 0, "configs": [{"type": "text", "textInput": "Hum", "sound_config_indices": [0]}],
                           "card_flow": {"contextAdvanced": [], "usageAdvanced": [0], "contextToUsageMap": {}, "usageToSoundMap": {"0": [0]}}},
        "sound_configs": [_sound(0, "cid-b0", 0, entity=False)],
        "sound_events": [_event("generated_cid-b0_0", "cid-b0", 0, "a0.wav")],
        "muted_sounds": ["generated_cid-b0_0"],
    }


def test_list_scenes_follows_usage_rule():
    scenes = list_scenes(source_data())
    assert [s["usage_index"] for s in scenes] == [1, 2, 3]
    assert [s["title"] for s in scenes] == ["Morning", "Rain", "Birds"]
    assert [s["sound_count"] for s in scenes] == [2, 1, 1]


def test_subset_merge_reindexes_everything():
    package = extract_package(source_data(), scene_numbers=[1], new_id=_ids())  # "Rain"
    merged = merge_package(target_data(), package)

    configs = merged["analysis_state"]["configs"]
    assert len(configs) == 3  # B's card + Rain + its parent context
    assert configs[1]["type"] == "model-analysis"
    assert configs[2]["textInput"] == "Rain"
    assert configs[2]["parentContextOriginalIndex"] == 1
    assert configs[2]["sound_config_indices"] == [1]

    assert [sc["index"] for sc in merged["sound_configs"]] == [0, 1]
    assert merged["sound_configs"][1]["parent_usage_original_index"] == 2
    new_cid = merged["sound_configs"][1]["config_id"]

    events = merged["sound_events"]
    assert len(events) == 2
    rain = events[1]
    assert rain["config_id"] == new_cid and rain["prompt_index"] == 1
    assert rain["id"] == f"generated_{new_cid}_0"  # legacy index id re-keyed
    assert merged["iteration_trims"] == {f"generated_{new_cid}_0-0": {"start": 0.1, "end": 0.9}}

    flow = merged["analysis_state"]["card_flow"]
    assert flow["contextToUsageMap"] == {"1": [2]}
    assert flow["usageToSoundMap"] == {"0": [0], "2": [1]}
    assert merged["muted_sounds"] == ["generated_cid-b0_0"]  # B's state untouched


def test_full_merge_speech_index_and_maps():
    package = extract_package(source_data(), new_id=_ids())
    merged = merge_package(target_data(), package)

    assert len(merged["analysis_state"]["configs"]) == 5
    assert len(merged["sound_configs"]) == 6
    assert len(merged["sound_events"]) == 7
    speech = next(e for e in merged["sound_events"] if e["id"].startswith("tts_"))
    assert speech["prompt_index"] == 2 * PROMPT_INDEX_BASE + 2  # card 1 -> 2, line kept
    assert speech["id"].endswith("_0_Kore")

    first = merged["sound_configs"][1]["config_id"]
    key = f"generated_{first}_0-1"
    assert merged["iteration_links"][key] == {"variantIndex": 1}  # entity keys stripped
    assert merged["soloed_sounds"] == [f"generated_{first}_1"]
    assert speech["id"] in merged["excluded_iterations"]
    assert len(merged["muted_sounds"]) == 2


def test_ids_are_fresh_and_double_transfer_does_not_collide():
    once = merge_package(target_data(), extract_package(source_data()))
    twice = merge_package(once, extract_package(source_data()))
    ids = [e["id"] for e in twice["sound_events"]]
    cids = [sc["config_id"] for sc in twice["sound_configs"]]
    assert len(ids) == len(set(ids))
    assert len(cids) == len(set(cids))
    src_ids = {e["id"] for e in source_data()["sound_events"]}
    assert not src_ids & set(ids)


def test_strip_spatial_for_other_model():
    merged = merge_package(target_data(), extract_package(source_data(), new_id=_ids()))
    for sc in merged["sound_configs"][1:]:
        assert sc.get("entity_node_ids") is None and sc.get("entity_index") is None
        assert sc.get("position") is None and sc.get("pinned") is False
    for ev in merged["sound_events"][1:]:
        assert ev["position"] == [0.0, 0.0, 0.0] and ev.get("entity_indices") is None
    rain = merged["analysis_state"]["configs"][3]
    assert "drawnArea" not in rain
    assert rain["prompts"][0]["entities"] == [] and "position" not in rain["prompts"][0]
    assert merged["analysis_state"]["configs"][1]["analysisResult"]["architecturalObjects"] == []


def test_same_model_keeps_links_and_positions():
    package = extract_package(source_data(), strip_entities=False, reset_positions=False)
    merged = merge_package(target_data(), package)
    ev = merged["sound_events"][1]
    assert ev["position"] == [5.0, 6.0, 7.0] and ev["entity_index"] == 7
    assert merged["sound_configs"][1]["entity_node_ids"] == ["obj-a"]


def test_into_empty_home_project():
    home = {"model_id": "home-sketch", "model_name": "Sketch"}
    merged = merge_package(home, extract_package(source_data(), scene_numbers=[0]))
    assert merged["analysis_state"]["configs"][1]["parentContextOriginalIndex"] == 0
    assert [sc["parent_usage_original_index"] for sc in merged["sound_configs"]] == [1, 1]
    SoundscapeData(**merged)


def test_audio_and_analysis_refs_and_renames():
    package = extract_package(source_data(), scene_numbers=[0, 2])
    assert package_audio_files(package) == ["a0.wav", "a0b.wav", "speech.wav", "birds.wav"]
    assert package_analysis_files(package) == ["analysis_an1.json", "scenarios_sc1.json"]

    apply_audio_renames(package, {"a0.wav": "a0_abc123.wav"}, missing={"birds.wav"})
    merged = merge_package(target_data(), package)
    names = [e["audio_filename"] for e in merged["sound_events"]]
    assert names == ["a0.wav", "a0_abc123.wav", "a0b.wav", "speech.wav", ""]


def test_auth_token_never_copied_and_schema_valid():
    merged = merge_package(target_data(), extract_package(source_data()))
    assert merged["auth_token"] == "SECRET-B"
    assert "SECRET-A" not in str(merged)
    SoundscapeData(**merged)


def test_rekey_event_id_shapes():
    assert rekey_event_id("generated_cid-x_2", "cid_x", "n_1", 0) == "generated_n-1_2"
    assert rekey_event_id("sed-cid-x-3", "cid-x", "n1", 0) == "sed-n1-3"
    assert rekey_event_id("generated_4_1", None, "n1", 4) == "generated_n1_1"
    assert rekey_event_id("weird", None, "n1", 0) == "weird-n1"


def test_run_end_to_end_writes_merge_backup_and_revision(tmp_path, monkeypatch):
    """Full CLI run against a temp data root (no real data/, app.db or Redis)."""
    import json
    import zipfile

    import transfer_scenes

    root = tmp_path / "soundscapes"
    data_dir = lambda ws: root / ws  # noqa: E731
    model_dir = lambda ws, m: root / ws / m  # noqa: E731
    audio_dir = lambda ws, m: root / ws / m / "audio"  # noqa: E731

    src = source_data()
    src_model = model_dir("wsA", "model-a")
    (src_model / "analysis").mkdir(parents=True)
    (src_model / "soundscape.json").write_text(json.dumps(src), encoding="utf-8")
    (src_model / "analysis" / "scenarios_sc1.json").write_text("{}", encoding="utf-8")
    (data_dir("wsA") / "audio").mkdir()  # legacy workspace-level audio dir
    for e in src["sound_events"]:
        (data_dir("wsA") / "audio" / e["audio_filename"]).write_bytes(e["audio_filename"].encode())

    dst = target_data()
    dst_model = model_dir("wsB", "model-b")
    (dst_model / "audio").mkdir(parents=True)
    (dst_model / "soundscape.json").write_text(json.dumps(dst), encoding="utf-8")
    (dst_model / "audio" / "a0.wav").write_bytes(b"B's own different a0")

    calls = []

    class FakeStore:
        def get_workspace(self, ws):
            return {"id": ws, "name": ws}

        def link_model(self, model_id, ws):
            calls.append(("link", model_id, ws))

        def bump_revision(self, ws):
            calls.append(("bump", ws))
            return 42

    import services.scene_transfer_service as service

    for module in (transfer_scenes, service):
        monkeypatch.setattr(module, "user_data_dir", data_dir)
        monkeypatch.setattr(module, "user_audio_dir", audio_dir)
    monkeypatch.setattr(transfer_scenes, "user_model_dir", model_dir)
    monkeypatch.setattr(service, "find_session_audio", lambda ws, name: None)
    monkeypatch.setattr(transfer_scenes, "metadata_store", FakeStore())
    monkeypatch.setattr(transfer_scenes, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(transfer_scenes, "target_is_active", lambda ws: False)
    monkeypatch.setattr(
        sys, "argv",
        ["transfer_scenes.py", "--from-workspace", "wsA", "--from-project", "office",
         "--to-workspace", "wsB", "--to-project", "Lobby", "--scenes", "0"],
    )

    assert transfer_scenes.main() == 0

    merged = json.loads((dst_model / "soundscape.json").read_text(encoding="utf-8"))
    SoundscapeData(**merged)
    assert merged["auth_token"] == "SECRET-B" and merged["model_id"] == "model-b"
    assert len(merged["sound_events"]) == 4  # B's 1 + Morning's 3
    copied = {e["audio_filename"] for e in merged["sound_events"][1:]}
    renamed = next(n for n in copied if n.startswith("a0_"))
    assert (dst_model / "audio" / renamed).read_bytes() == b"a0.wav"  # clash renamed
    assert (dst_model / "audio" / "a0.wav").read_bytes() == b"B's own different a0"  # B's file intact
    assert (dst_model / "analysis" / "scenarios_sc1.json").is_file()
    assert calls == [("link", "model-b", "wsB"), ("bump", "wsB")]
    backups = list((tmp_path / "backups").glob("*.zip"))
    assert len(backups) == 1
    with zipfile.ZipFile(backups[0]) as zf:
        assert json.loads(zf.read("soundscape.json"))["sound_events"] == dst["sound_events"]


def test_plan_audio_reuses_identical_and_renames_clash(tmp_path, monkeypatch):
    import services.scene_transfer_service as service

    src_dir = tmp_path / "src"
    dst_dir = tmp_path / "dst"
    src_dir.mkdir()
    dst_dir.mkdir()
    (src_dir / "same.wav").write_bytes(b"same")
    (dst_dir / "same.wav").write_bytes(b"same")
    (src_dir / "clash.wav").write_bytes(b"from-a")
    (dst_dir / "clash.wav").write_bytes(b"from-b")
    (src_dir / "new.wav").write_bytes(b"new")
    monkeypatch.setattr(service, "user_audio_dir", lambda ws, model: src_dir)
    monkeypatch.setattr(service, "find_session_audio", lambda ws, name: None)

    copies, renames, missing = service.plan_audio(
        "ws", "m", dst_dir, ["same.wav", "clash.wav", "new.wav", "gone.wav"]
    )
    assert missing == {"gone.wav"}
    assert "same.wav" not in renames and "same.wav" not in copies
    assert renames["clash.wav"].startswith("clash_") and renames["clash.wav"] in copies
    assert copies["new.wav"] == src_dir / "new.wav"


# ── in-app send (services/scene_transfer_service.py) ─────────────────────────


class _FakeStore:
    def __init__(self, revision=5):
        self.revision = revision
        self.calls = []

    def get_workspace(self, ws):
        return {"id": ws, "revision": self.revision}

    def link_model(self, model_id, ws):
        self.calls.append(("link", model_id, ws))

    def bump_revision(self, ws):
        self.revision += 1
        self.calls.append(("bump", ws))
        return self.revision


def _service_env(tmp_path, monkeypatch, with_target=True):
    import json

    import services.scene_transfer_service as service

    root = tmp_path / "soundscapes"
    monkeypatch.setattr(service, "user_data_dir", lambda ws: root / ws)
    monkeypatch.setattr(service, "user_model_dir", lambda ws, m: root / ws / m)
    monkeypatch.setattr(service, "user_audio_dir", lambda ws, m: root / ws / m / "audio")
    monkeypatch.setattr(service, "find_session_audio", lambda ws, name: None)
    store = _FakeStore()
    monkeypatch.setattr(service, "metadata_store", store)

    src = source_data()
    src_audio = root / "ws" / "model-a" / "audio"
    src_audio.mkdir(parents=True)
    (root / "ws" / "model-a" / "soundscape.json").write_text(json.dumps(src), encoding="utf-8")
    for e in src["sound_events"]:
        (src_audio / e["audio_filename"]).write_bytes(e["audio_filename"].encode())
    if with_target:
        dst_audio = root / "ws" / "model-b" / "audio"
        dst_audio.mkdir(parents=True)
        (root / "ws" / "model-b" / "soundscape.json").write_text(json.dumps(target_data()), encoding="utf-8")
        (dst_audio / "a0.wav").write_bytes(b"B's own different a0")
    return service, store, root


def _read(path):
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def test_send_scenes_by_usage_index_appends_and_renames(tmp_path, monkeypatch):
    service, store, root = _service_env(tmp_path, monkeypatch)
    result = service.SceneTransferService().send_scenes("ws", "model-a", "model-b", [1], base_revision=5)

    merged = _read(root / "ws" / "model-b" / "soundscape.json")
    SoundscapeData(**merged)
    assert result["scenes_sent"] == 1 and result["sounds_sent"] == 2 and result["events_sent"] == 3
    assert result["revision"] == 6 and store.calls == [("link", "model-b", "ws"), ("bump", "ws")]
    assert merged["auth_token"] == "SECRET-B"
    # B's scene untouched; Morning (+ its context card) appended after it.
    configs = merged["analysis_state"]["configs"]
    assert configs[0]["textInput"] == "Hum" and configs[2]["display_name"] == "Morning"
    assert configs[2]["parentContextOriginalIndex"] == 1
    new_sounds = merged["sound_configs"][1:]
    assert all(sc["parent_usage_original_index"] == 2 for sc in new_sounds)
    assert all(sc["entity_node_ids"] is None for sc in new_sounds)
    new_events = merged["sound_events"][1:]
    assert all(e["position"] == [0.0, 0.0, 0.0] for e in new_events)
    renamed = next(e["audio_filename"] for e in new_events if e["audio_filename"].startswith("a0_"))
    assert (root / "ws" / "model-b" / "audio" / renamed).read_bytes() == b"a0.wav"
    assert (root / "ws" / "model-b" / "audio" / "a0.wav").read_bytes() == b"B's own different a0"
    # Source is a copy, not a move.
    assert len(_read(root / "ws" / "model-a" / "soundscape.json")["sound_events"]) == 6


def test_send_scenes_keep_positions(tmp_path, monkeypatch):
    service, _, root = _service_env(tmp_path, monkeypatch)
    service.SceneTransferService().send_scenes("ws", "model-a", "model-b", [3], keep_positions=True)
    event = _read(root / "ws" / "model-b" / "soundscape.json")["sound_events"][-1]
    assert event["position"] == [5.0, 6.0, 7.0] and event["entity_indices"] is None


def test_send_scenes_creates_fresh_target(tmp_path, monkeypatch):
    service, _, root = _service_env(tmp_path, monkeypatch, with_target=False)
    service.SceneTransferService().send_scenes(
        "ws", "model-a", "model-new", [2, 3],
        target_meta={"project_id": "proj", "version_id": "v9"},
    )
    merged = _read(root / "ws" / "model-new" / "soundscape.json")
    assert merged["model_id"] == "model-new" and merged["model_name"] == "model-new"
    assert merged["project_id"] == "proj" and merged["version_id"] == "v9" and merged["auth_token"] == ""
    assert len(merged["sound_configs"]) == 2
    assert (root / "ws" / "model-new" / "audio" / "rain.wav").is_file()


def test_send_scenes_rejects_stale_revision_and_bad_selection(tmp_path, monkeypatch):
    import pytest

    service, store, root = _service_env(tmp_path, monkeypatch)
    svc = service.SceneTransferService()
    with pytest.raises(service.SceneTransferConflict) as exc:
        svc.send_scenes("ws", "model-a", "model-b", [1], base_revision=4)
    assert exc.value.revision == 5
    with pytest.raises(ValueError):
        svc.send_scenes("ws", "model-a", "model-b", [0])  # context card, not a scene
    with pytest.raises(ValueError):
        svc.send_scenes("ws", "model-a", "model-a", [1])
    with pytest.raises(FileNotFoundError):
        svc.send_scenes("ws", "model-missing", "model-b", [1])
    assert store.calls == []
    assert len(_read(root / "ws" / "model-b" / "soundscape.json")["sound_events"]) == 1
