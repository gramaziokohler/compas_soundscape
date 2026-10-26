# backend/tests/test_pffdtd_free.py
"""Free positioning end to end (worker -> compas-pffdtd pipeline -> raw store -> resident IR
server via POST /api/pffdtd/free-ir), on the shoebox of test_pffdtd_pipeline.

- free listener: a moved listener's IR (nearest grid point) equals a dedicated run's IR with
  the listener on that grid node
- free source (FOA listener, reciprocal W + 3 pair runs): the configured pairs' IRs equal the
  forward run's, and a moved source's IR equals a dedicated forward run with the source there
- the endpoint: outside the grid (409), unknown simulation (404), superseded requests dropped

Skipped unless the compas-pffdtd env (PFFDTD_PYTHON) and the built engine are present.
"""

import json
import shutil
import sys
import uuid
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))  # test_pffdtd_pipeline (shoebox scene)

from config.constants import PFFDTD_FREE_MODE_LISTENER, PFFDTD_FREE_MODE_SOURCE, PFFDTD_RIR_DIR  # noqa: E402
from routers import pffdtd_free  # noqa: E402
from services.pffdtd_free import free_dir, reset_store  # noqa: E402
from services.pffdtd_ir_server import Superseded, ir_server  # noqa: E402
from services.pffdtd_job import pffdtd_available, run_pffdtd_simulation_from_geometry  # noqa: E402
from test_pffdtd_pipeline import DURATION, FMAX, PPW, RECEIVER_2, RECEIVER_X, SOURCE, _geometry, _pairs  # noqa: E402

pytestmark = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))

SPACING = 0.5
RUN_TAG = uuid.uuid4().hex[:8]
WAV_TOL = 1e-4  # float32 raw store + float32 WAVs


@pytest.fixture(scope="module")
def client():
    app = FastAPI()
    app.include_router(pffdtd_free.router)
    return TestClient(app)


@pytest.fixture
def sim_ids():
    ids: list[str] = []
    yield ids
    for sid in ids:
        reset_store(sid)


def _run(tmp_path, tag, mode, pairs, sim_ids, free_mode="off"):
    sim_id = f"test_free_{tag}_{RUN_TAG}"  # unique: other checkouts / sessions may run the suite at once
    sim_ids.append(sim_id)
    result_file = tmp_path / f"result_{tag}.json"
    run_pffdtd_simulation_from_geometry(
        simulation_id=sim_id, progress_file=str(tmp_path / f"progress_{tag}.json"), result_file=str(result_file),
        geometry=_geometry(), pairs_data=pairs, simulation_mode=mode, fmax=FMAX, ppw=PPW, duration=DURATION,
        air_absorption=True, simulation_name="pffdtd-free-test", rir_output_dir=str(tmp_path), temp_dir=str(tmp_path),
        free_mode=free_mode, free_grid_spacing=SPACING,
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    return sim_id, json.loads((tmp_path / result["result"]["results_file"]).read_text())


def _wav(path) -> np.ndarray:
    return wavfile.read(str(path))[1].astype(np.float64)


def _pair_wav(tmp_path, results, sid, rid) -> np.ndarray:
    entry = next(e for e in results["results"] if e["source_id"] == sid and e["receiver_id"] == rid)
    return _wav(tmp_path / entry["ir_file"])


def _rel(a, b) -> float:
    return float(np.max(np.abs(a - b)) / np.max(np.abs(b)))


def _grid_point_near(sim_id, target) -> list:
    raw = (free_dir(sim_id) / "free_points.bin").read_bytes()
    n = len(raw) // 13
    xyz = np.frombuffer(raw, np.float32, 3 * n).reshape(n, 3).astype(np.float64)
    valid = np.frombuffer(raw, np.uint8, n, offset=12 * n).astype(bool)
    cand = np.flatnonzero(valid)
    return xyz[cand[np.argmin(np.linalg.norm(xyz[cand] - np.asarray(target), axis=1))]].tolist()


def _free_ir(client, sim_id, object_id, position) -> dict:
    r = client.post("/api/pffdtd/free-ir", json={"simulation_id": sim_id, "object_id": object_id, "position": position})
    assert r.status_code == 200, r.text
    return r.json()


def test_free_listener_matches_dedicated_run(tmp_path, client, sim_ids):
    pairs = [{"source_id": "s1", "source_position": SOURCE, "receiver_id": "rx", "receiver_position": RECEIVER_X}]
    sim_id, results = _run(tmp_path, "listener", "mono", pairs, sim_ids, free_mode=PFFDTD_FREE_MODE_LISTENER)
    free = results["free"]
    assert free["mode"] == PFFDTD_FREE_MODE_LISTENER and free["fixed_ids"] == ["s1"]
    assert free["n_valid"] > 10 and free["spacing_m"] == pytest.approx(SPACING, rel=0.2)
    assert results["field"] is not None  # forward mode keeps the field outputs

    node = _grid_point_near(sim_id, [2.0, 2.0, 1.5])
    moved = _free_ir(client, sim_id, "rx", [node[0] + 0.1, node[1], node[2]])  # snaps back onto the node
    assert moved["snapped_position"] == pytest.approx(node) and moved["num_channels"] == 1
    assert moved["render_ms"] > 0
    free_wav = _wav(Path(PFFDTD_RIR_DIR) / moved["irs"][0]["ir_file"])
    again = _free_ir(client, sim_id, "rx", node)  # cached
    assert again["render_ms"] == 0 and again["irs"] == moved["irs"]

    pairs_node = [{"source_id": "s1", "source_position": SOURCE, "receiver_id": "g", "receiver_position": node}]
    _, dedicated = _run(tmp_path, "listener_ref", "mono", pairs_node, sim_ids)
    assert _rel(free_wav, _pair_wav(tmp_path, dedicated, "s1", "g")) < WAV_TOL


def test_free_source_reciprocal_foa(tmp_path, client, sim_ids):
    sim_id, results = _run(tmp_path, "source", "foa", _pairs(), sim_ids, free_mode=PFFDTD_FREE_MODE_SOURCE)
    free = results["free"]
    assert free["mode"] == PFFDTD_FREE_MODE_SOURCE and free["foa"] and free["fixed_ids"] == ["rx", "r2"]
    assert results["field"] is None and len(results["grid"]["runs"]) == 8  # 2 listeners x (W, X, Y, Z)

    _, forward = _run(tmp_path, "source_fwd", "foa", _pairs(), sim_ids)
    for rid in ("rx", "r2"):
        assert _rel(_pair_wav(tmp_path, results, "s1", rid), _pair_wav(tmp_path, forward, "s1", rid)) < WAV_TOL

    node = _grid_point_near(sim_id, [2.0, 1.0, 1.0])
    moved = _free_ir(client, sim_id, "s1", node)
    assert moved["num_channels"] == 4 and [i["fixed_id"] for i in moved["irs"]] == ["rx", "r2"]
    pairs_node = [
        {"source_id": "g", "source_position": node, "receiver_id": "rx", "receiver_position": RECEIVER_X},
        {"source_id": "g", "source_position": node, "receiver_id": "r2", "receiver_position": RECEIVER_2},
    ]
    _, dedicated = _run(tmp_path, "source_ref", "foa", pairs_node, sim_ids)
    for item in moved["irs"]:
        free_wav = _wav(Path(PFFDTD_RIR_DIR) / item["ir_file"])
        assert free_wav.shape[1] == 4
        assert _rel(free_wav, _pair_wav(tmp_path, dedicated, "g", item["fixed_id"])) < WAV_TOL

    r = client.post("/api/pffdtd/free-ir", json={"simulation_id": sim_id, "object_id": "s1", "position": [50.0, 50.0, 50.0]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "outside_grid"
    r = client.get(f"/api/pffdtd/free-grid/{sim_id}/points")
    assert r.status_code == 200 and len(r.content) == 13 * free["n_points"]


def test_free_ir_unknown_simulation(client):
    r = client.post("/api/pffdtd/free-ir", json={"simulation_id": "test_free_missing", "object_id": "a", "position": [0, 0, 0]})
    assert r.status_code == 404
    r = client.post("/api/pffdtd/free-ir", json={"simulation_id": "../x", "object_id": "a", "position": [0, 0, 0]})
    assert r.status_code == 400


def test_superseded_requests_are_dropped():
    key = ("test_free_superseded", "obj")
    old = pffdtd_free._claim(key)
    new = pffdtd_free._claim(key)
    assert not pffdtd_free._is_latest(key, old) and pffdtd_free._is_latest(key, new)
    with pytest.raises(Superseded):  # checked before the server is even started
        ir_server.render(Path("unused"), 0, [0], [Path("unused.wav")], lambda: pffdtd_free._is_latest(key, old))


def test_reset_store_removes_cached_wavs(tmp_path):
    sim_id = "test_free_reset"
    d = free_dir(sim_id)
    d.mkdir(parents=True, exist_ok=True)
    wav = Path(PFFDTD_RIR_DIR) / f"pffdtd_{sim_id}_free_p0_a.wav"
    wav.parent.mkdir(parents=True, exist_ok=True)
    wav.write_bytes(b"x")
    reset_store(sim_id)
    assert not d.exists() and not wav.exists()
    shutil.rmtree(d, ignore_errors=True)
