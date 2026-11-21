"""services/finished_simulations.py: durable records of finished simulation jobs."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from services import finished_simulations as fs  # noqa: E402


def _speckle(**kwargs):
    return {"variant": "pyroomacoustics_speckle", "kwargs": kwargs}


def test_records_simulation_jobs_and_lists_them_per_model_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "TEMP_FINISHED_SIMULATIONS_DIR", str(tmp_path))
    meta = {"modelId": "m1", "configId": "sim_1"}
    fs.write_record("job-a", "pyroomacoustics", "ws1", _speckle(), meta, {"simulation_id": "a"})
    monkeypatch.setattr(fs.time, "time", lambda: 9e9)
    fs.write_record("job-b", "pffdtd", "ws1", {"variant": "hybrid"}, {"modelId": "m1"}, {"simulation_id": "b"})
    fs.write_record("job-c", "pffdtd", "ws1", {}, {"modelId": "m2"}, {"simulation_id": "c"})

    records = fs.list_records("ws1", "m1")
    assert [r["job_id"] for r in records] == ["job-b", "job-a"]
    assert records[1]["meta"] == meta
    assert records[1]["result"] == {"simulation_id": "a"}
    assert fs.list_records("ws2", "m1") == []
    assert fs.list_records("ws1", "m2")[0]["job_id"] == "job-c"


def test_skips_jobs_that_are_not_card_simulations(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "TEMP_FINISHED_SIMULATIONS_DIR", str(tmp_path))
    for job_type, payload in (
        ("pyroomacoustics", {"variant": "pyroomacoustics_preflight"}),
        ("pyroomacoustics", {"variant": "acoustic_paths"}),
        ("pffdtd_animation", {}),
        ("sed", {"variant": "sed"}),
    ):
        assert fs.write_record("j", job_type, "ws1", payload, {"modelId": "m1"}, {}) is None
    assert fs.write_record("j", "pyroomacoustics", "", _speckle(), {"modelId": "m1"}, {}) is None
    assert fs.list_records("ws1", "m1") == []


def test_model_id_falls_back_to_the_payload_and_names_are_sanitised(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "TEMP_FINISHED_SIMULATIONS_DIR", str(tmp_path))
    path = fs.write_record("../evil", "pyroomacoustics", "../ws", _speckle(model_id="m9"), None, {})
    assert path is not None and tmp_path in path.parents
    assert fs.list_records("../ws", "m9")[0]["model_id"] == "m9"
