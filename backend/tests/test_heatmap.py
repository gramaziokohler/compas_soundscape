# backend/tests/test_heatmap.py
"""Heatmap listener card (compas_acoustics EnergyMap, one map per source at 0 dB).

A 6 x 5 x 3 m shoebox far from the origin with two sources and a few points, one outside:

* the job writes the documented JSON (model coordinates, 7 bands, a row per point per source);
* the point outside the room is null in every source and flagged ``inside: false``;
* the energy sum of the per-source maps raised by a level equals one EnergyMap of both sources
  at that level (the frontend's weighting is exact);
* the router validates its inputs and serves the document only to its own workspace.
"""

import json
import uuid
from types import SimpleNamespace

import numpy as np
import pytest

pytest.importorskip("compas_acoustics")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from config.constants import HEATMAP_MAX_POINTS  # noqa: E402
from models.schemas import MeshPrepSettings  # noqa: E402
from routers import heatmap as heatmap_router  # noqa: E402
from services import heatmap_service  # noqa: E402
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService  # noqa: E402

ORIGIN = np.array([120.0, 80.0, 0.0])   # a georeferenced-like model: the document must come back unshifted
SOURCES = {"s1": ORIGIN + [1.5, 2.5, 1.5], "s2": ORIGIN + [4.5, 1.5, 1.2]}
POINTS = [
    (ORIGIN + [3.0, 2.5, 1.2]).tolist(),
    (ORIGIN + [1.0, 4.0, 1.2]).tolist(),
    (ORIGIN + [5.0, 4.0, 1.2]).tolist(),
    (ORIGIN + [3.0, 2.5, 10.0]).tolist(),   # above the ceiling
]
OUTSIDE = 3
LEVEL_DB = 80.0
N_BANDS = 7


def _box():
    lx, ly, lz = 6.0, 5.0, 3.0
    v = [[0, 0, 0], [lx, 0, 0], [lx, ly, 0], [0, ly, 0], [0, 0, lz], [lx, 0, lz], [lx, ly, lz], [0, ly, lz]]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    f = []
    for a, b, c, d in quads:
        f += [[a, b, c], [a, c, d]]
    vertices = (np.asarray(v, float) + ORIGIN).tolist()
    return SimpleNamespace(
        vertices=vertices, faces=f, object_face_ranges={"room": [0, len(f) - 1]},
        face_materials={i: 0.3 for i in range(len(f))}, face_scattering=None,
    )


# Each source with a dummy receiver (the card's listener is the points); s1 appears twice.
PAIRS = [
    {"source_id": s_id, "source_position": pos.tolist(), "receiver_id": "heatmap",
     "receiver_position": (ORIGIN + [3.0, 2.5, 1.2]).tolist(), "source_directivity_spec": None}
    for s_id, pos in SOURCES.items()
] + [{"source_id": "s1", "source_position": SOURCES["s1"].tolist(), "receiver_id": "other",
      "receiver_position": (ORIGIN + [2.0, 2.0, 1.2]).tolist(), "source_directivity_spec": None}]


@pytest.fixture(scope="module")
def job(tmp_path_factory):
    """Runs the job entry on the box (Speckle loading stubbed): (document, result, payload_dir)."""
    tmp = tmp_path_factory.mktemp("heatmap")
    heatmap_id = str(uuid.uuid4())
    original = heatmap_service.load_speckle_simulation_geometry
    heatmap_service.load_speckle_simulation_geometry = lambda *args, **kwargs: _box()
    try:
        heatmap_service.run_heatmap(
            heatmap_id, "project", "version", "Acoustics", None, {}, {}, PAIRS, POINTS,
            MeshPrepSettings().model_dump(), str(tmp / "payload"), str(tmp / "progress.json"), str(tmp / "result.json"),
        )
    finally:
        heatmap_service.load_speckle_simulation_geometry = original
    result = json.loads((tmp / "result.json").read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    doc = json.loads((tmp / "payload" / result["result"]["payload_file"]).read_text())
    return doc, result["result"], heatmap_id


def test_document_shape(job):
    doc, result, heatmap_id = job
    assert result == {"heatmap_id": heatmap_id, "payload_file": f"heatmap_{heatmap_id}.json"}
    assert set(doc) == {"heatmap_id", "bands", "inside", "points", "sources", "n_rays", "warnings"}
    assert doc["heatmap_id"] == heatmap_id
    assert doc["bands"] == [125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0]
    assert len(doc["inside"]) == len(POINTS)
    np.testing.assert_allclose(doc["points"], POINTS, atol=0.01)
    assert [s["id"] for s in doc["sources"]] == ["s1", "s2"]          # deduplicated, in order
    for source in doc["sources"]:
        np.testing.assert_allclose(source["position"], SOURCES[source["id"]], atol=0.01)
        assert len(source["spl_bands"]) == len(POINTS)
        for k, row in enumerate(source["spl_bands"]):
            if doc["inside"][k]:
                assert len(row) == N_BANDS and all(isinstance(v, float) for v in row)
                # 0 dB at 1 m, the points 1.3-3.5 m away in a reverberant box: around -10 to +10 dB
                assert all(-20.0 < v < 15.0 for v in row)
    assert doc["n_rays"] > 0


def test_outside_point_is_null(job):
    doc, _, _ = job
    assert doc["inside"] == [k != OUTSIDE for k in range(len(POINTS))]
    assert all(s["spl_bands"][OUTSIDE] is None for s in doc["sources"])
    assert any("outside the room" in w for w in doc["warnings"])


def test_energy_sum_matches_both_sources_at_that_level(job):
    """sum_i 10^((L_i + level)/10) of the per-source maps == the map of both sources at ``level``."""
    import compas_acoustics as ca

    from services.acoustic_paths_service import scene_geometry
    from services.compas_acoustics_engine import build_scene
    from services.pyroomacoustics_room_builder import room_offset

    doc, _, _ = job
    box = _box()
    mesh = SimulationMeshService.prepare(
        box.vertices, box.faces, box.object_face_ranges, box.face_materials, None,
        [p.tolist() for p in SOURCES.values()], MeshPrepOptions.from_settings(MeshPrepSettings()),
    )
    offset = room_offset(mesh)
    pairs = heatmap_service.unique_source_pairs(PAIRS)
    scene, _, _ = build_scene(pairs, list(range(len(pairs))), offset)
    for source in scene.sources:
        source.spl = [LEVEL_DB] * N_BANDS
    with pytest.warns(UserWarning), scene_geometry(heatmap_service.heatmap_geometry(mesh, offset)):
        both = ca.EnergyMap.from_scene(scene, np.asarray(POINTS) - offset, seed=True).spl()

    for k in range(len(POINTS)):
        if k == OUTSIDE:
            assert np.all(np.isnan(both[k]))
            continue
        per_source = np.array([s["spl_bands"][k] for s in doc["sources"]], dtype=float) + LEVEL_DB
        summed = 10.0 * np.log10(np.sum(10.0 ** (per_source / 10.0), axis=0))
        np.testing.assert_allclose(summed, both[k], atol=0.5)


# ── router ────────────────────────────────────────────────────────────────────

class _FakeJobStore:
    def __init__(self):
        self.enqueued = []

    async def enqueue(self, job_type, session_id, payload):
        self.enqueued.append((job_type, session_id, payload))
        return "job-1"

    async def get(self, job_id):
        return SimpleNamespace(position=1, total=1)


@pytest.fixture
def client(monkeypatch, tmp_path):
    store = _FakeJobStore()
    monkeypatch.setattr(heatmap_router, "job_store", store)
    monkeypatch.setattr(heatmap_router, "HEATMAP_DIR", str(tmp_path))
    app = FastAPI()

    @app.middleware("http")
    async def workspace(request, call_next):
        request.state.session_id = request.headers.get("x-ws", "ws-a")
        return await call_next(request)

    app.include_router(heatmap_router.router)
    return TestClient(app), store, tmp_path


def _form(**overrides):
    form = {
        "speckle_project_id": "p", "speckle_version_id": "v",
        "object_materials": json.dumps({"obj": "concrete"}),
        "source_receiver_pairs": json.dumps([{k: v for k, v in p.items() if k != "source_directivity_spec"} for p in PAIRS]),
        "points": json.dumps(POINTS),
    }
    form.update(overrides)
    return form


def test_enqueues_heatmap_variant(client):
    http, store, tmp = client
    r = http.post("/api/acoustics/heatmap-speckle", data=_form())
    assert r.status_code == 200, r.text
    assert r.json() == {"job_id": "job-1", "position": 1, "total": 1}
    (job_type, session_id, payload), = store.enqueued
    assert session_id == "ws-a"
    assert payload["variant"] == "heatmap"
    kwargs = payload["kwargs"]
    uuid.UUID(kwargs["heatmap_id"])
    assert kwargs["points"] == POINTS
    assert len(kwargs["pairs_data"]) == len(PAIRS)
    assert kwargs["payload_dir"] == str(tmp / "ws-a")


@pytest.mark.parametrize("overrides, status", [
    ({"object_materials": "{}"}, 400),
    ({"source_receiver_pairs": "[]"}, 400),
    ({"points": "[]"}, 400),
    ({"points": "not json"}, 400),
    ({"points": json.dumps([[1, 2]])}, 400),
    ({"points": json.dumps([[1, 2, "x"]])}, 400),
    ({"points": json.dumps([[1, 2, True]])}, 400),
    ({"points": json.dumps({"x": 1})}, 400),
    ({"points": json.dumps([[0.0, 0.0, 0.0]] * (HEATMAP_MAX_POINTS + 1))}, 400),
])
def test_rejects_bad_input(client, overrides, status):
    http, store, _ = client
    r = http.post("/api/acoustics/heatmap-speckle", data=_form(**overrides))
    assert r.status_code == status, r.text
    assert store.enqueued == []


def test_without_compas_acoustics(client, monkeypatch):
    http, store, _ = client
    real = heatmap_router.importlib.util.find_spec
    monkeypatch.setattr(heatmap_router.importlib.util, "find_spec",
                        lambda name, *a: None if name == "compas_acoustics" else real(name, *a))
    assert http.post("/api/acoustics/heatmap-speckle", data=_form()).status_code == 501


def test_get_is_scoped_to_the_workspace(client):
    http, _, tmp = client
    heatmap_id = str(uuid.uuid4())
    (tmp / "ws-a").mkdir()
    heatmap_service.heatmap_payload_path(str(tmp / "ws-a"), heatmap_id).write_text('{"heatmap_id": "x"}')
    assert http.get(f"/api/acoustics/heatmap/{heatmap_id}").json() == {"heatmap_id": "x"}
    assert http.get(f"/api/acoustics/heatmap/{heatmap_id}", headers={"x-ws": "ws-b"}).status_code == 404
    assert http.get("/api/acoustics/heatmap/..%2Fsecret").status_code in (400, 404)
    assert http.get("/api/acoustics/heatmap/not-a-uuid").status_code == 400
