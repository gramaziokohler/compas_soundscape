"""POST /api/public/client-diagnostics — browser crash / emergency log (JSONL)."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import services.client_diagnostics_service as service_module
from routers import client_diagnostics


@pytest.fixture
def log_path(tmp_path, monkeypatch):
    path = tmp_path / "logs" / "client_diagnostics.jsonl"
    monkeypatch.setattr(service_module, "CLIENT_DIAGNOSTICS_LOG", path)
    return path


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(client_diagnostics.router)
    return TestClient(app)


def _event(**overrides):
    event = {
        "kind": "crash",
        "page": "/share/abc",
        "share_id": "abc",
        "client_session_id": "s1",
        "occurred_at": "2026-11-20T12:00:00Z",
        "details": {"memoryMB": 1650},
    }
    event.update(overrides)
    return event


def test_appends_one_json_line_per_event(client, log_path):
    assert client.post("/api/public/client-diagnostics", json=_event()).status_code == 204
    assert client.post("/api/public/client-diagnostics", json=_event(kind="emergency")).status_code == 204
    lines = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert [line["kind"] for line in lines] == ["crash", "emergency"]
    assert lines[0]["share_id"] == "abc"
    assert lines[0]["details"] == {"memoryMB": 1650}


def test_rejects_unknown_kinds(client, log_path):
    assert client.post("/api/public/client-diagnostics", json=_event(kind="nope")).status_code == 422
    assert not log_path.exists()


def test_truncates_oversized_details(client, log_path):
    client.post("/api/public/client-diagnostics", json=_event(details={"blob": "x" * 40000}))
    line = json.loads(log_path.read_text(encoding="utf-8"))
    assert line["details"]["truncated"] is True


def test_rotates_past_the_size_cap(client, log_path, monkeypatch):
    monkeypatch.setattr(service_module, "CLIENT_DIAGNOSTICS_MAX_LOG_BYTES", 10)
    client.post("/api/public/client-diagnostics", json=_event())
    client.post("/api/public/client-diagnostics", json=_event(kind="emergency"))
    rotated = log_path.with_suffix(".jsonl.1")
    assert rotated.exists()
    assert json.loads(log_path.read_text(encoding="utf-8"))["kind"] == "emergency"
