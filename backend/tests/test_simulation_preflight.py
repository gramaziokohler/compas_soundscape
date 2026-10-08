# backend/tests/test_simulation_preflight.py
"""Preflight issue detection on synthetic scenes (no Speckle).

Checks the user-facing warnings: outside sources, leaks + leaking holes,
blocked direct paths, separated rooms, engine-specific severities, and that
the preview payload is JSON-serializable and consistent.
"""

import json

import numpy as np

from services.simulation_preflight_service import (
    ENGINE_CHORAS,
    ENGINE_PYROOMACOUSTICS,
    PreflightContext,
    SeedMeta,
    SimulationPreflightService,
)
from tests.test_simulation_mesh import _Scene, _box, _room
from utils.preflight_payload import build_preflight_payload


def _analyze(scene, sources, receivers, engine=ENGINE_PYROOMACOUSTICS, **settings):
    seeds = [SeedMeta(f"s{i}", "source", p) for i, p in enumerate(sources)]
    seeds += [SeedMeta(f"r{i}", "receiver", p) for i, p in enumerate(receivers)]
    mesh = scene.prepare([s.position for s in seeds], **settings)
    ctx = PreflightContext(
        engine=engine, seeds=seeds,
        pairs=[(s.id, r.id) for s in seeds if s.kind == "source" for r in seeds if r.kind == "receiver"],
        max_order=3, ray_tracing=True,
    )
    return mesh, ctx, SimulationPreflightService.analyze(mesh, ctx)


def _codes(analysis, severity=None):
    return {i.code for i in analysis.issues if severity is None or i.severity == severity}


def test_clean_box_has_no_errors_or_warnings():
    scene = _Scene()
    _room(scene)
    _, _, a = _analyze(scene, [[2, 2, 1.5]], [[4, 2, 1.5]])
    assert not _codes(a, "error")
    assert not _codes(a, "warning")


def test_outside_source_is_an_error():
    scene = _Scene()
    _room(scene)
    _, _, a = _analyze(scene, [[20, 2, 1.5]], [[4, 2, 1.5]])
    assert "seed_outside" in _codes(a, "error")


def test_missing_ceiling_triangle_leaks():
    scene = _Scene()
    v, f = _box(0, 0, 0, 6, 4, 3)
    del f[2]
    scene.add("room", v, f)
    _, _, a = _analyze(scene, [[2, 2, 1.5]], [[4, 2, 1.5]])
    assert "leaking_hole" in _codes(a, "error")
    assert "sound_leak" in _codes(a)
    assert any(a.loop_leaking)


def test_partial_wall_blocks_direct_path():
    scene = _Scene()
    _room(scene)
    cv, cf = _box(2.9, 1, 0, 3.1, 3, 3)  # thick wall, gap on both sides
    scene.add("divider", cv, cf)
    _, _, a = _analyze(scene, [[1.5, 2, 1.5]], [[4.5, 2, 1.5]])
    assert "direct_path_blocked" in _codes(a, "warning")
    assert "no_acoustic_path" not in _codes(a)
    assert a.blocked_paths and a.blocked_paths[0]["face_ids"]


def test_closed_rooms_have_no_acoustic_path():
    scene = _Scene()
    va, fa = _box(0, 0, 0, 3, 4, 3)
    vb, fb = _box(3.2, 0, 0, 6, 4, 3)
    scene.add("a", va, fa)
    scene.add("b", vb, fb)
    _, _, a = _analyze(scene, [[1.5, 2, 1.5]], [[4.5, 2, 1.5]])
    assert "no_acoustic_path" in _codes(a, "error")


def test_choras_profile_rejects_thin_surfaces():
    scene = _Scene()
    _room(scene)
    scene.add("panel", [[3, 1, 0.5], [3, 3, 0.5], [3, 3, 2.5], [3, 1, 2.5]], [[0, 1, 2], [0, 2, 3]])
    _, _, pra_a = _analyze(scene, [[1.5, 2, 1.5]], [[4.5, 2, 1.5]])
    _, _, ch_a = _analyze(scene, [[1.5, 2, 1.5]], [[4.5, 2, 1.5]], engine=ENGINE_CHORAS, merge_coplanar=False)
    assert "two_sided_surfaces" in _codes(pra_a, "info")
    assert "two_sided_surfaces" in _codes(ch_a, "error")
    assert "open_edges" in _codes(ch_a, "error")


def test_payload_is_serializable_and_consistent():
    scene = _Scene()
    v, f = _box(0, 0, 0, 6, 4, 3)
    del f[2]
    scene.add("room", v, f)
    mesh, ctx, a = _analyze(scene, [[2, 2, 1.5]], [[4, 2, 1.5]])
    payload = build_preflight_payload("pid", ENGINE_PYROOMACOUSTICS, mesh, a, ctx, {})
    text = json.dumps(payload)
    back = json.loads(text)
    n_faces = len(back["faces"]) // 3
    for key in ("face_class", "two_sided", "flipped", "closed", "obstructing", "face_wall", "air_hits"):
        assert len(back[key]) == n_faces, key
    assert len(back["vertices"]) % 3 == 0
    assert back["loops"] and back["loops"][0]["leaking"]
    assert back["leaks"]
    assert np.isfinite(back["stats"]["air_volume_m3"])
