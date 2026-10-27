# backend/tests/test_directivity_resolver.py
"""Orientation maths, typed pair parsing, the per-user library table and id resolution."""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from models.schemas import SourceDirectivityRef, SourceReceiverPair  # noqa: E402
from services import directivity_service as svc  # noqa: E402
from services.directivity_formats import Balloon  # noqa: E402
from services.directivity_processing import process_balloon, save_npz  # noqa: E402
from services.metadata_store import MetadataStore  # noqa: E402
from utils.orientation import forward_vector, rotate_source_frame, rotation_matrix  # noqa: E402
from utils.request_parsing import parse_source_receiver_pairs  # noqa: E402


# ── orientation ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("yaw,pitch", [(0, 0), (np.pi / 2, 0), (-1.2, 0.4), (3.0, -0.7)])
def test_forward_matches_camera_convention(yaw, pitch):
    expected = [-np.sin(yaw) * np.cos(pitch), -np.cos(yaw) * np.cos(pitch), np.sin(pitch)]
    assert np.allclose(forward_vector(yaw, pitch), expected)


def test_rotation_matrix_is_proper_and_keeps_up_at_rest():
    R = rotation_matrix(0.4, -0.3, 0.9)
    assert np.allclose(R @ R.T, np.eye(3)) and np.isclose(np.linalg.det(R), 1.0)
    rest = rotation_matrix()
    assert np.allclose(rest[:, 0], [0, -1, 0])  # source front -> -Y
    assert np.allclose(rest[:, 1], [1, 0, 0])   # source left -> +X
    assert np.allclose(rest[:, 2], [0, 0, 1])   # source up -> +Z
    # yaw = +90 deg turns the front toward -X; pitch = +90 deg points it up
    assert np.allclose(forward_vector(np.pi / 2, 0), [-1, 0, 0], atol=1e-12)
    assert np.allclose(forward_vector(0, np.pi / 2), [0, 0, 1], atol=1e-12)
    rotated = rotate_source_frame(np.array([[1.0, 0, 0], [0, 0, 1.0]]), np.pi, 0, 0)
    assert np.allclose(rotated, [[0, 1, 0], [0, 0, 1]], atol=1e-12)


# ── request parsing ─────────────────────────────────────────────────────────

def test_parse_pairs_with_and_without_directivity():
    raw = json.dumps([
        {"source_id": "pos_1_2_3", "source_position": [1, 2, 3], "receiver_id": "r1", "receiver_position": [0, 0, 1]},
        {"source_id": "pos_1_2_3~dabcdef01", "source_position": [1, 2, 3], "receiver_id": "r1",
         "receiver_position": [0, 0, 1], "source_directivity": {"id": "cardioid", "yaw": 1.5}},
    ])
    pairs = parse_source_receiver_pairs(raw)
    assert pairs[0].source_directivity is None
    assert pairs[1].source_directivity.id == "cardioid" and pairs[1].source_directivity.yaw == 1.5
    assert pairs[1].source_directivity.pitch == 0.0 and not pairs[1].source_directivity.is_omni
    assert SourceDirectivityRef().is_omni


@pytest.mark.parametrize("raw", ["[]", "null", "not json", '[{"source_id": "a"}]',
                                 '[{"source_id":"a","source_position":[1,2],"receiver_id":"r","receiver_position":[0,0,0]}]'])
def test_parse_pairs_rejects_bad_input(raw):
    with pytest.raises(HTTPException) as exc:
        parse_source_receiver_pairs(raw)
    assert exc.value.status_code == 400


# ── library table ───────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path):
    s = MetadataStore(db_path=str(tmp_path / "app.db"))
    s.init_db()
    return s


def _create(store, user, did, name="Horn"):
    return store.create_user_directivity(user, did, name, "sofa", "Src", 48000, 540, 512,
                                         json.dumps({"residual": [0.1]}), json.dumps({"bands_hz": []}))


def test_library_crud_is_scoped_to_user(store):
    row = _create(store, "alice", "dir_a")
    assert row["id"] == "dir_a" and row["n_points"] == 540
    assert [r["id"] for r in store.list_user_directivities("alice")] == ["dir_a"]
    assert store.list_user_directivities("bob") == [] and store.list_user_directivities("") == []
    assert store.count_user_directivities("alice") == 1
    assert store.get_user_directivity("bob", "dir_a") is None
    assert store.rename_user_directivity("bob", "dir_a", "X") is None
    assert store.rename_user_directivity("alice", "dir_a", "Tweeter")["name"] == "Tweeter"
    assert store.delete_user_directivity("bob", "dir_a") is None
    assert store.delete_user_directivity("alice", "dir_a")["id"] == "dir_a"
    assert store.count_user_directivities("alice") == 0
    record = svc.to_api(_create(store, "alice", "dir_b", "B"))
    assert record.kind == "measured" and record.fit_residual == [0.1] and record.origin == "library"


# ── resolution ──────────────────────────────────────────────────────────────

def _cardioid_balloon(n=400):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    dirs = np.column_stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)])
    irs = np.zeros((n, 512))
    irs[:, 50] = 0.5 + 0.5 * dirs[:, 0]
    return Balloon(directions=dirs, irs=irs, fs=48000.0, fmt="sofa")


@pytest.fixture
def library(tmp_path, store, monkeypatch):
    monkeypatch.setattr(svc, "metadata_store", store)
    monkeypatch.setattr(svc, "DIRECTIVITY_DATA_DIR", str(tmp_path / "lib"))
    monkeypatch.setattr(svc, "DIRECTIVITY_PRESET_DIR", str(tmp_path / "lib" / "presets"))
    processed = process_balloon(_cardioid_balloon())
    save_npz(svc.library_file("alice", "dir_x"), processed)
    _create(store, "alice", "dir_x", "Cardioid horn")
    return store


def test_resolve_omni_and_analytical():
    assert svc.resolve(None, "alice", None, None) is None
    assert svc.resolve(SourceDirectivityRef(id="omni", yaw=1.0), "alice", None, None) is None
    spec = svc.resolve(SourceDirectivityRef(id="cardioid", yaw=0.5, pitch=-0.1), "alice", None, None)
    assert spec["kind"] == "analytical" and spec["p"] == 0.5 and spec["yaw"] == 0.5 and spec["pitch"] == -0.1
    assert spec["fit"]["a"] == [0.5]


def test_resolve_library_entry_and_unknown(library):
    spec = svc.resolve(SourceDirectivityRef(id="dir_x", yaw=0.2), "alice", None, None)
    assert spec["kind"] == "measured" and spec["label"] == "Cardioid horn" and Path(spec["path"]).exists()
    assert np.allclose(spec["fit"]["a"], 0.5, atol=0.03) and len(spec["fit"]["bands_hz"]) == 7
    with pytest.raises(HTTPException) as exc:
        svc.resolve(SourceDirectivityRef(id="dir_x"), "bob", None, None)
    assert exc.value.status_code == 400 and "import it" in exc.value.detail
    with pytest.raises(HTTPException):
        svc.resolve(SourceDirectivityRef(id="dir_missing"), "alice", None, None)
    with pytest.raises(HTTPException) as exc:
        svc.resolve(SourceDirectivityRef(id="preset_genelec_8020"), "alice", None, None)
    assert "prepared" in exc.value.detail


def test_soundscape_copy_resolves_for_collaborator(library, tmp_path, monkeypatch):
    import services.directivity_service as module

    monkeypatch.setattr(module, "user_model_dir", lambda sid, mid: tmp_path / "soundscapes" / sid / mid)
    assert svc.copy_library_files_to_model("alice", "ws1", "model1", ["dir_x", "cardioid", "dir_nope"]) == 1
    spec = svc.resolve(SourceDirectivityRef(id="dir_x"), "bob", "ws1", "model1")
    assert spec["kind"] == "measured" and "soundscapes" in spec["path"]
    assert svc.preview_for("dir_x", "bob", "ws1", "model1")["bands_hz"] == [250.0, 1000.0, 4000.0]
    assert svc.preview_for("cardioid", None, None, None)["p"] == 0.5
    with pytest.raises(HTTPException):
        svc.preview_for("dir_x", "bob", "ws2", "model1")


def test_balloon_bytes_layout(library):
    import struct

    from config.constants import DIRECTIVITY_BALLOON_MAGIC

    raw = svc.balloon_bytes("dir_x", "alice", None, None)
    assert raw[:4] == DIRECTIVITY_BALLOON_MAGIC
    n, taps, fs = struct.unpack("<III", raw[4:16])
    assert n == 400 and taps == 512 and fs == 48000
    assert len(raw) == 16 + 4 * (n * 3 + n * taps)
    dirs = np.frombuffer(raw[16:16 + 12 * n], dtype="<f4").reshape(n, 3)
    assert np.allclose(np.linalg.norm(dirs, axis=1), 1.0, atol=1e-5)
    with pytest.raises(HTTPException):
        svc.balloon_bytes("cardioid", "alice", None, None)
    with pytest.raises(HTTPException):
        svc.balloon_bytes("dir_x", "bob", None, None)


def test_attach_specs_and_any_directional(library):
    pairs = [
        SourceReceiverPair(source_id="a", source_position=[0, 0, 1], receiver_id="r", receiver_position=[1, 0, 1]),
        SourceReceiverPair(source_id="b", source_position=[0, 0, 1], receiver_id="r", receiver_position=[1, 0, 1],
                           source_directivity=SourceDirectivityRef(id="dir_x", yaw=0.3)),
        SourceReceiverPair(source_id="b", source_position=[0, 0, 1], receiver_id="r2", receiver_position=[2, 0, 1],
                           source_directivity=SourceDirectivityRef(id="dir_x", yaw=0.3)),
    ]
    out = svc.attach_directivity_specs(pairs, "alice", None, None)
    assert out[0]["source_directivity_spec"] is None and out[0]["source_position"] == [0, 0, 1]
    assert out[1]["source_directivity_spec"]["id"] == "dir_x" and out[1]["source_directivity_spec"] is out[2]["source_directivity_spec"]
    assert svc.any_directional(out) and not svc.any_directional(out[:1])
    listed = {r.id: r for r in svc.list_for_user("alice")}
    assert listed["dir_x"].name == "Cardioid horn" and listed["cardioid"].p == 0.5
    assert listed["preset_hats_4128c"].available is False and listed["preset_hats_4128c"].kind == "measured"
    assert svc.delete_library_entry("alice", "dir_x") and not svc.library_file("alice", "dir_x").exists()
