# backend/tests/test_acoustic_paths.py
"""Sound paths stored with a run and the diffraction edge selection (compas_acoustics engine).

A 6 x 5 x 3 m shoebox with a free-standing panel between the source and the listener:

* reflections: the direct path is blocked by the panel, first-order paths have 3 points, delays
  follow the path length, coordinates are model coordinates (the room is far from the origin);
* diffraction: the panel's four rims are found; excluding them removes every diffracted path,
  and the simulation with them excluded equals the one without diffraction;
* a run stores its paths: image sources up to ACOUSTIC_PATHS_MAX_ORDER, diffracted paths on request;
* the ambisonic tail options build the compas_acoustics method they name.
"""

import numpy as np
import pytest

pytest.importorskip("compas_acoustics")

from models.schemas import MeshPrepSettings  # noqa: E402
from services import compas_acoustics_engine as engine  # noqa: E402
from config.constants import ACOUSTIC_PATHS_MAX_ORDER  # noqa: E402
from services.acoustic_paths_service import compute_paths, room_diffraction_edges  # noqa: E402
from services.pyroomacoustics_room_builder import room_offset  # noqa: E402
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService  # noqa: E402

ORIGIN = np.array([120.0, 80.0, 0.0])   # a georeferenced-like model: paths must come back unshifted
SOURCE = ORIGIN + [1.5, 2.5, 1.5]
LISTENER = ORIGIN + [4.5, 2.5, 1.5]


def _room_with_panel():
    lx, ly, lz = 6.0, 5.0, 3.0
    v = [[0, 0, 0], [lx, 0, 0], [lx, ly, 0], [0, ly, 0], [0, 0, lz], [lx, 0, lz], [lx, ly, lz], [0, ly, lz]]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    f = []
    for a, b, c, d in quads:
        f += [[a, b, c], [a, c, d]]
    n_room = len(f)
    base = len(v)
    v += [[3.0, 1.5, 0.5], [3.0, 3.5, 0.5], [3.0, 3.5, 2.5], [3.0, 1.5, 2.5]]   # panel across the direct path
    f += [[base, base + 1, base + 2], [base, base + 2, base + 3]]
    vertices = (np.asarray(v, float) + ORIGIN).tolist()
    ranges = {"room": [0, n_room - 1], "panel": [n_room, n_room + 1]}
    materials = {i: 0.3 for i in range(len(f))}
    return vertices, f, ranges, materials


@pytest.fixture(scope="module")
def mesh():
    vertices, faces, ranges, materials = _room_with_panel()
    return SimulationMeshService.prepare(
        vertices, faces, ranges, materials, None, [SOURCE.tolist(), LISTENER.tolist()],
        MeshPrepOptions.from_settings(MeshPrepSettings()),
    )


PAIRS = [{"source_id": "s1", "source_position": SOURCE.tolist(), "receiver_id": "r1", "receiver_position": LISTENER.tolist()}]


def _paths(mesh, max_order=2, diffraction=True, excluded_edges=None):
    offset = room_offset(mesh)
    return compute_paths(PAIRS, offset, engine.room_geometry(mesh, offset), max_order,
                         diffraction=diffraction, excluded_edges=excluded_edges)


@pytest.fixture(scope="module")
def doc(mesh):
    return _paths(mesh)


@pytest.fixture(scope="module")
def edges(mesh):
    return room_diffraction_edges(mesh)


def test_panel_is_two_sided(mesh):
    assert int(mesh.two_sided.sum()) == 2


def test_reflection_paths(doc):
    paths = doc["reflections"]["paths"]
    assert paths and all(p["order"] <= 2 for p in paths)
    assert not any(p["order"] == 0 for p in paths)                 # the panel blocks the direct sound
    first = [p for p in paths if p["order"] == 1]
    assert first
    for p in first:
        pts = np.asarray(p["points"]).reshape(-1, 3)
        assert len(pts) == 3
        np.testing.assert_allclose(pts[0], SOURCE, atol=1e-3)
        np.testing.assert_allclose(pts[-1], LISTENER, atol=1e-3)
        length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
        assert p["distance"] == pytest.approx(length, abs=1e-2)
        assert p["delay_ms"] == pytest.approx(1000 * length / doc["speed_of_sound"], abs=0.05)
        assert p["level_db"] < 0                                     # longer than 1 m and absorbed once
    assert [p["delay_ms"] for p in paths] == sorted(p["delay_ms"] for p in paths)


def test_panel_rims_diffract(doc, edges):
    rims = [e for e in edges if e["kind"] == "obstacle"]
    assert len(rims) == 4
    assert all(e["wedge_deg"] == pytest.approx(0.0, abs=0.5) for e in rims)   # knife edges
    assert sorted(round(e["length"], 2) for e in rims) == [2.0, 2.0, 2.0, 2.0]
    paths = doc["diffraction"]["paths"]
    assert paths and all(p["zone"] in ("shadow", "view", "reflection") for p in paths)


def test_excluded_edges_carry_no_path(mesh, doc, edges):
    excluded = [e["segment"] for e in edges]
    assert all(e["excluded"] for e in room_diffraction_edges(mesh, excluded))
    assert _paths(mesh, excluded_edges=excluded)["diffraction"]["paths"] == []
    assert sum(e["excluded"] for e in room_diffraction_edges(mesh, excluded[:1])) == 1
    assert len(_paths(mesh, excluded_edges=excluded[:1])["diffraction"]["paths"]) < len(doc["diffraction"]["paths"])


def test_a_run_stores_its_paths(mesh):
    offset = room_offset(mesh)
    base = dict(ray_tracing=False, air_absorption=False, n_jobs=1)

    def run(**kwargs):
        return engine.simulate_pairs(mesh, offset, PAIRS, engine.EngineSettings(**base, **kwargs), lambda f, t, d: None).paths

    paths = run(max_order=3)
    assert paths["reflections"]["max_order"] == ACOUSTIC_PATHS_MAX_ORDER     # capped for the view
    assert paths["reflections"]["paths"] and all(p["order"] <= ACOUSTIC_PATHS_MAX_ORDER for p in paths["reflections"]["paths"])
    assert [r["id"] for r in paths["receivers"]] == ["r1"] and [s["id"] for s in paths["sources"]] == ["s1"]
    assert "diffraction" not in paths
    assert run(max_order=0)["reflections"]["max_order"] == 0                # never above the run's own order
    assert "diffraction" not in run(max_order=1, paths_diffraction=True)     # the run does not diffract
    assert run(max_order=1, diffraction="udfa", paths_diffraction=True)["diffraction"]["paths"]


def _comparable(doc, kind):
    return sorted((p["s"], p["r"], p["order"], round(p["distance"], 2), p["level_db"] or 0.0)
                  for p in (doc.get(kind) or {}).get("paths", []))


def _assert_same_paths(kept, searched, kind, level_tolerance_db):
    a, b = _comparable(kept, kind), _comparable(searched, kind)
    assert [row[:4] for row in a] == [row[:4] for row in b]
    np.testing.assert_allclose([row[4] for row in a], [row[4] for row in b], atol=level_tolerance_db)


def test_a_run_keeps_its_own_paths_without_a_second_search(mesh, monkeypatch):
    """The paths of the run's own image source and diffraction searches equal those a second search finds."""
    from services import acoustic_paths_service

    if not acoustic_paths_service.recording_available():
        pytest.skip("this compas_acoustics does not keep a run's paths (record_paths)")
    offset = room_offset(mesh)
    settings = engine.EngineSettings(max_order=2, ray_tracing=False, air_absorption=False, n_jobs=1,
                                     diffraction="udfa", paths_diffraction=True)
    searched = engine.run_paths(PAIRS, offset, engine.room_geometry(mesh, offset), settings, None,
                                lambda text: None, lambda notes: None)

    def second_search(*args, **kwargs):
        raise AssertionError("the run searched its paths a second time")

    monkeypatch.setattr(acoustic_paths_service, "compute_paths", second_search)
    kept = engine.simulate_pairs(mesh, offset, PAIRS, settings, lambda f, t, d: None).paths
    assert kept["reflections"]["paths"] and kept["diffraction"]["paths"]
    _assert_same_paths(kept, searched, "reflections", 0.01)
    # the run's diffracted paths carry its own air (absorption off here); a display search always applies air
    _assert_same_paths(kept, searched, "diffraction", 0.5)


def test_without_the_recorder_the_paths_are_searched_again(mesh, monkeypatch):
    from services import acoustic_paths_service

    monkeypatch.setattr(acoustic_paths_service, "recording_available", lambda: False)
    offset = room_offset(mesh)
    paths = engine.simulate_pairs(mesh, offset, PAIRS, engine.EngineSettings(max_order=1, ray_tracing=False, n_jobs=1),
                                  lambda f, t, d: None).paths
    assert paths["reflections"]["paths"]


def test_edge_matching_is_by_position():
    seg = np.array([[0.0, 0, 0, 2.0, 0, 0]])
    assert engine.edge_excluded([0, 0, 0], [2, 0, 0], seg)
    assert engine.edge_excluded([2, 0, 0], [0, 0, 0], seg)            # either direction
    assert engine.edge_excluded([0, 0, 0], [1, 0, 0], seg)            # a piece of it
    assert not engine.edge_excluded([0, 0.1, 0], [2, 0.1, 0], seg)    # parallel, 10 cm away
    assert not engine.edge_excluded([1, -1, 0], [1, 1, 0], seg)       # crossing it
    assert not engine.edge_excluded([0, 0, 0], [2, 0, 0], np.zeros((0, 6)))


def test_simulation_without_the_edges_equals_no_diffraction(mesh, edges):
    offset = room_offset(mesh)
    base = dict(max_order=1, ray_tracing=False, air_absorption=False, n_jobs=1)

    def run(**kwargs):
        out = engine.simulate_pairs(mesh, offset, PAIRS, engine.EngineSettings(**base, **kwargs), lambda f, t, d: None)
        return out.responses[0].rir

    plain = run()
    diffracted = run(diffraction="udfa")
    excluded = run(diffraction="udfa", excluded_edges=[e["segment"] for e in edges])
    n = min(len(plain), len(diffracted), len(excluded))
    assert np.max(np.abs(diffracted[:n] - plain[:n])) > 1e-4          # the rims add sound behind the panel
    np.testing.assert_allclose(excluded[:n], plain[:n], atol=1e-9)


@pytest.mark.parametrize("tail, ray_tracing, expected", [
    ("auto", True, "reference"), ("auto", False, "eyring"), ("reference", False, "reference"),
    ("eyring", True, "eyring"), ("sabine", True, "sabine"),
])
def test_tail_options(tail, ray_tracing, expected):
    method, _ = engine.build_method(engine.EngineSettings(
        ambisonic_order=1, tail=tail, ray_tracing=ray_tracing, n_rays=1234, seed=9,
    ))
    assert method.tail == expected
    if expected == "reference":
        # The histogram is traced with this Mono, so the card's ray count and seed have to be on it.
        assert method.reference.ray_tracing is True
        assert method.reference.n_rays == 1234
        assert method.reference.seed == 9
        assert method.reference.reciprocity is False


@pytest.mark.parametrize("tail, late_field", [
    ("auto", "fdn"), ("reference", "fdn"), ("eyring", "fdn"), ("sabine", "fdn"), ("moments", "moments"),
])
def test_tail_late_field(tail, late_field):
    method, _ = engine.build_method(engine.EngineSettings(ambisonic_order=1, tail=tail, ray_tracing=True, n_rays=1234, seed=9))
    assert method.late_field == late_field
    if late_field == "moments":
        # its own Mono at the method's order, so the late energy is the reference's rays'
        assert method.reference.ray_tracing is True
        assert method.reference.image_source_order == method.image_source_order


@pytest.mark.parametrize("order", [2, 3])
def test_moments_tail_is_first_order_only(order):
    with pytest.raises(ValueError, match="first order"):
        engine.build_method(engine.EngineSettings(ambisonic_order=order, tail="moments"))


def test_unknown_tail():
    with pytest.raises(ValueError, match="tail"):
        engine.build_method(engine.EngineSettings(ambisonic_order=1, tail="plate"))


def test_an_open_model_still_diffracts_and_raises_no_open_model_issue():
    """Without its ceiling the room does not close. Its edges are still searched (compas_acoustics finds them
    from the air around each edge): the panel's rims diffract, the open rim of the walls does not, and
    neither the notes nor the preflight say the corners are skipped."""
    from services.simulation_preflight_service import (
        ENGINE_PYROOMACOUSTICS, PreflightContext, SeedMeta, SimulationPreflightService,
    )

    vertices, faces, ranges, materials = _room_with_panel()
    keep = [i for i in range(len(faces)) if i not in (2, 3)]            # drop the ceiling quad
    faces = [faces[i] for i in keep]
    ranges = {"room": [0, len(faces) - 3], "panel": [len(faces) - 2, len(faces) - 1]}
    materials = {i: 0.3 for i in range(len(faces))}
    mesh = SimulationMeshService.prepare(
        vertices, faces, ranges, materials, None, [SOURCE.tolist(), LISTENER.tolist()],
        MeshPrepOptions.from_settings(MeshPrepSettings()),
    )
    notes: list = []
    edges = room_diffraction_edges(mesh, notes=notes)
    assert len(edges) == 4 and all(e["kind"] == "obstacle" for e in edges)
    assert not any("does not close" in note for note in notes)

    def issues(diffraction):
        ctx = PreflightContext(
            engine=ENGINE_PYROOMACOUSTICS,
            seeds=[SeedMeta(id="s1", kind="source", position=SOURCE.tolist()),
                   SeedMeta(id="r1", kind="receiver", position=LISTENER.tolist())],
            pairs=[("s1", "r1")], max_order=2, ray_tracing=True,
            geometric_engine="compas_acoustics", simulation_mode="mono", diffraction=diffraction,
        )
        return {i.code: i.severity for i in SimulationPreflightService.analyze(mesh, ctx).issues}

    assert "ca_diffraction_open_model" not in issues("udfa")
    assert "ca_diffraction_open_model" not in issues("off")
