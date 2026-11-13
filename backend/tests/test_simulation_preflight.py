# backend/tests/test_simulation_preflight.py
"""Preflight issue detection on synthetic scenes (no Speckle).

Checks the user-facing warnings: outside sources, leaks + leaking holes,
blocked direct paths, separated rooms, engine-specific severities, and that
the preview payload is JSON-serializable and consistent.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))  # shared mesh fixtures

from services.simulation_preflight_service import (
    ENGINE_PYROOMACOUSTICS,
    PreflightContext,
    SeedMeta,
    SimulationPreflightService,
)
from test_simulation_mesh import _Scene, _box, _room
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


def test_ca_hybrid_open_model_warns_only_when_sound_escapes():
    """Ambisonic late-field warning follows acoustic leak, not welded topology alone."""
    from dataclasses import replace

    from config.constants import PREFLIGHT_LEAK_WARNING_FRACTION

    scene = _Scene()
    v, f = _box(0, 0, 0, 6, 4, 3)
    del f[2]
    scene.add("room", v, f)
    seeds = [
        SeedMeta("s0", "source", [2, 2, 1.5]),
        SeedMeta("r0", "receiver", [4, 2, 1.5]),
    ]
    mesh = scene.prepare([s.position for s in seeds])
    assert mesh.air_volume > 0
    assert mesh.visibility.leak_fraction >= PREFLIGHT_LEAK_WARNING_FRACTION

    def codes(mesh, mode):
        ctx = PreflightContext(
            engine=ENGINE_PYROOMACOUSTICS, seeds=seeds, pairs=[("s0", "r0")],
            max_order=3, ray_tracing=True,
            geometric_engine="compas_acoustics", simulation_mode=mode,
        )
        return {i.code for i in SimulationPreflightService.analyze(mesh, ctx).issues}

    assert "ca_hybrid_open_model" in codes(mesh, "foa")
    assert "ca_hybrid_open_model" not in codes(mesh, "mono")

    sealed = replace(mesh, visibility=replace(mesh.visibility, n_escaped=0, n_reemitted=max(mesh.visibility.n_reemitted, 1)))
    assert sealed.visibility.leak_fraction == 0.0
    assert "ca_hybrid_open_model" not in codes(sealed, "foa")
    assert "ca_hybrid_no_volume" not in codes(sealed, "foa")


def test_skipped_faces_lists_wholly_unreached_objects():
    """Objects with no face reached by sound are listed (to exclude them by removing their
    material); objects in the air are not, and the unreached faces are still simulated walls."""
    scene = _Scene()
    _room(scene)
    pv, pf = _box(2.8, 1.8, 0, 3.2, 2.2, 3)       # pillar inside the room: reached
    scene.add("pillar", pv, pf)
    ov, of = _box(10, 0, 0, 11, 1, 1)            # block outside the closed room: never reached
    scene.add("outside", ov, of)
    mesh, _, a = _analyze(scene, [[1.5, 2, 1.5]], [[4.5, 2, 1.5]])
    issue = next(i for i in a.issues if i.code == "skipped_faces")
    assert issue.severity == "info"
    assert issue.object_ids == ["outside"]
    assert "removing their material" in issue.detail
    outside = set(np.flatnonzero(mesh.face_object == mesh.objects.index("outside")).tolist())
    assert outside <= set(issue.face_ids)
    assert outside <= {int(f) for w in mesh.walls for f in w.faces}


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
