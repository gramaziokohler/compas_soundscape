"""CPU-only unit tests of the benchmark's geometric-acoustics side (compas_acoustics / pyroomacoustics)."""
import hashlib
import json
from dataclasses import asdict

import numpy as np
import pytest

from benchmarks.bras import bras_constants as K
from benchmarks.bras import bras_pra
from benchmarks.bras.bras_analysis import PairResult
from benchmarks.bras.bras_benchmark import shadow_split
from benchmarks.bras.bras_pra import PraConfig
from config.constants import ACOUSTICS_ENGINE_COMPAS_ACOUSTICS, ACOUSTICS_ENGINE_PYROOMACOUSTICS

CA, PRA = ACOUSTICS_ENGINE_COMPAS_ACOUSTICS, ACOUSTICS_ENGINE_PYROOMACOUSTICS


def test_compas_acoustics_diffracts_by_default_and_takes_the_chamber_air(monkeypatch):
    monkeypatch.delenv(K.ENV_GA_DIFFRACTION, raising=False)
    cfg = PraConfig("RS5", 3, True, ["LS1-MP1"], engine=CA, temperature_c=20.3, humidity=40.3)
    assert cfg.diffraction == K.GA_DIFFRACTION_DEFAULT == "udfa" and cfg.diffracts
    assert cfg.tag().startswith("RS5_ca_ism3+rt+udfa_dir_p1_")
    assert cfg.short_label() == "compas_acoustics (UDFA, RT)"
    assert "UDFA edge diffraction" in cfg.describe() and "20.3 degC / 40.3 % RH" in cfg.describe()
    monkeypatch.setenv(K.ENV_GA_DIFFRACTION, "off")
    off = PraConfig("RS5", 3, False, ["LS1-MP1"], engine=CA)
    assert not off.diffracts and off.tag().startswith("RS5_ca_ism3_dir_") and off.short_label() == "compas_acoustics"
    assert "no diffraction" in off.describe()


def test_btms_and_unknown_engines_are_refused():
    with pytest.raises(ValueError, match="ambisonic"):
        PraConfig("RS5", 3, False, ["LS1-MP1"], engine=CA, diffraction="btms")
    with pytest.raises(ValueError, match="engine"):
        PraConfig("RS5", 3, False, ["LS1-MP1"], engine="raven")


def test_legacy_engine_keeps_its_tag_and_cache_hash():
    """The legacy runs cached before the engine became a setting must still be found."""
    cfg = PraConfig("RS2", 3, False, ["LS1-MP1"], True, "csv", engine=PRA, temperature_c=17.6, humidity=47.0,
                    diffraction="udfa", n_rays=123)
    assert cfg.temperature_c is None and cfg.humidity is None and not cfg.diffracts
    pairs = hashlib.sha1(b"LS1-MP1").hexdigest()[:6]
    assert cfg.tag() == f"RS2_pra_ism3_dir_p1_{pairs}"
    geometry, pairs_data = {"vertices": [], "faces": []}, [{"source_id": "LS1"}]
    old = {"scene": "RS2", "max_order": 3, "ray_tracing": False, "pair_keys": ["LS1-MP1"], "directional": True,
           "material_mode": "csv"}
    payload = json.dumps([old, geometry, pairs_data, K.PRA_MESH_SETTINGS], sort_keys=True, default=str)
    assert bras_pra._hash(cfg, geometry, pairs_data) == hashlib.sha1(payload.encode()).hexdigest()
    assert bras_pra.frac_delay_lead(PRA) > 0 and bras_pra.frac_delay_lead(CA) == 0


def test_settings_change_the_compas_acoustics_cache_key():
    base = PraConfig("RS5", 3, False, ["LS1-MP1"], engine=CA, diffraction="udfa")
    for other in (PraConfig("RS5", 3, True, ["LS1-MP1"], engine=CA, diffraction="udfa"),
                  PraConfig("RS5", 3, False, ["LS1-MP1"], engine=CA, diffraction="off"),
                  PraConfig("RS5", 3, True, ["LS1-MP1"], engine=CA, diffraction="udfa", n_rays=500)):
        assert bras_pra._hash(other, {}, []) != bras_pra._hash(base, {}, [])
    assert asdict(base)["engine"] == CA


def test_silent_responses_are_no_sound_path():
    irs, no_path = bras_pra._silent({"LS1-MP1": np.zeros(8), "LS1-MP2": np.r_[0.0, 1.0]}, ["LS2-MP1"])
    assert list(irs) == ["LS1-MP2"] and no_path == ["LS2-MP1", "LS1-MP1"]


def _result(key, los, dl):
    return PairResult(key, key[:3], key[4:], los, 1.0, None, 0.0, None, [500.0], [dl], abs(dl), abs(dl))


def test_shadow_split_reports_both_engines_on_line_of_sight_and_shadowed_pairs():
    first = [_result("LS1-MP1", True, 1.0), _result("LS1-MP2", False, -4.0), _result("LS2-MP2", False, 2.0)]
    second = [_result("LS1-MP1", True, 0.5), _result("LS1-MP2", False, 1.0)]
    lines = shadow_split(first, second, "compas_acoustics (UDFA)")
    assert lines[0] == "Pairs with line of sight: mean |dL| PFFDTD 1.00 dB (1 pairs), compas_acoustics (UDFA) 0.50 dB (1 pairs)."
    assert "diffraction only" in lines[1] and "PFFDTD 3.00 dB (2 pairs)" in lines[1] and "1.00 dB (1 pairs)" in lines[1]


def test_ga_scene_finds_the_object_edges_and_none_on_the_absorbing_shell():
    """A 25 mm plate between a loudspeaker and a microphone, inside the shell: compas_acoustics
    diffracts on the plate's 12 edges (a closed box seen from outside: a room within a room); the
    shell's corners are right angles (integer wedge index) and give none."""
    pytest.importorskip("compas_acoustics")
    from benchmarks.bras.bras_geometry import box, enclosed_geometry, geometry_dict

    mdf = {"coeffs": [0.1] * 6, "center_freqs": [125, 250, 500, 1000, 2000, 4000]}
    v, f = box([-0.0125, -0.5, 0.5], [0.0125, 0.5, 1.5])
    geo = enclosed_geometry(geometry_dict([(v, f, ["mdf"] * len(f))], {"mdf": mdf}), ([-3, -3, -1], [3, 3, 3]))
    pairs = [{"source_id": "LS1", "source_position": [-2.0, 0.0, 1.0], "receiver_id": "MP1",
              "receiver_position": [2.0, 0.0, 1.0]}]
    ga = bras_pra.ga_scene(PraConfig("T", 1, False, ["LS1-MP1"], engine=CA, diffraction="udfa"), geo, pairs)
    assert ga.walls >= 7 and len(ga.edges) == 12
    assert ga.scene_edges == ga.edges                                 # none on the shell
    ends = np.array([np.r_[e[0], e[1]] for e in ga.edges]).reshape(-1, 3)
    assert np.all(np.abs(ends[:, 0]) <= 0.013) and np.all(np.abs(ends[:, 1]) <= 0.501)   # on the plate
    assert "12 diffracting edges on the scene" in ga.describe() and "shell" not in ga.describe()
    no_diff = bras_pra.ga_scene(PraConfig("T", 1, False, ["LS1-MP1"], engine=CA, diffraction="off"), geo, pairs)
    assert no_diff.edges == [] and no_diff.walls == ga.walls


def test_hemi_anechoic_shell_closes_on_the_floor_so_a_partition_diffracts():
    """RS5-like: a bottomless 25 mm partition standing on the floor. compas_acoustics takes it as an
    obstacle (``geometry.standing_objects``), the shell with the floor as its bottom is the boundary
    and closes, and the partition's top and side edges diffract; the edges where it meets the
    floor and the shell's corners (right angles) give none."""
    pytest.importorskip("compas_acoustics")
    from benchmarks.bras.bras_geometry import SceneMesh, box, ga_scene_geometry

    v, f = box([-0.0125, -1.0, 0.0], [0.0125, 1.0, 2.0])
    f = f[2:]                                                        # no bottom: it stands on the floor
    mdf = {"coeffs": [0.1] * 6, "center_freqs": [125, 250, 500, 1000, 2000, 4000]}
    tiles = {"coeffs": [0.02] * 6, "center_freqs": [125, 250, 500, 1000, 2000, 4000]}
    mesh = SceneMesh(v, f, ["mdf"] * len(f), ["mdf"] * len(f), v.min(axis=0), v.max(axis=0))
    ground = type("G", (), {"z": 0.0, "material": "tiles"})()
    geo = ga_scene_geometry(mesh, {"mdf": mdf, "tiles": tiles}, ([-3, -3, 0], [3, 3, 4]), ground)
    assert K.PRA_FLOOR_KEY in geo["object_face_ranges"]
    pairs = [{"source_id": "LS1", "source_position": [-2.0, 0.0, 1.0], "receiver_id": "MP1",
              "receiver_position": [2.0, 0.0, 1.0]}]
    ga = bras_pra.ga_scene(PraConfig("T", 1, False, ["LS1-MP1"], engine=CA, diffraction="udfa"), geo, pairs)
    assert ga.closed
    ends = np.array([np.r_[e[0], e[1]] for e in ga.scene_edges]).reshape(-1, 2, 3)
    top = [e for e in ends if np.allclose(e[:, 2], 2.0)]
    assert len(top) >= 2                                            # both top edges of the partition
    assert all(np.all(np.abs(e[:, 0]) <= 0.013) for e in ends)     # only partition edges
    assert not any(np.allclose(e[:, 2], 0.0) for e in ends)         # not where it meets the floor


def _slotted_plate_and_battens():
    """A 1 x 1 m plate in two halves 5 mm apart (one object) and a batten 0.3 m away (another)."""
    from benchmarks.bras.bras_geometry import SceneMesh, box

    parts = [box((0, 0, 0), (0.025, 0.4975, 1.0)), box((0, 0.5025, 0), (0.025, 1.0, 1.0)),
             box((0.3, 0, 0), (0.42, 1.0, 0.24))]
    v, f, off = [], [], 0
    for pv, pf in parts:
        v.append(pv)
        f.append(pf + off)
        off += len(pv)
    f = np.vstack(f)
    v = np.vstack(v)
    return SceneMesh(v, f, ["mdf"] * len(f), ["mdf"] * len(f), v.min(axis=0), v.max(axis=0))


def test_object_boxes_merge_close_parts_into_one_box_of_six_walls():
    from benchmarks.bras.bras_geometry import box_scene_mesh, object_boxes

    boxes = sorted(object_boxes(_slotted_plate_and_battens()), key=lambda b: b.center[0])
    assert [b.parts for b in boxes] == [2, 1]
    np.testing.assert_allclose(2 * boxes[0].half, [0.025, 1.0, 1.0], atol=1e-9)
    np.testing.assert_allclose(boxes[0].axes, np.eye(3), atol=1e-9)
    out = box_scene_mesh(_slotted_plate_and_battens(), boxes)
    assert len(out.faces) == 24
    # outward winding: every face normal points away from its box centre
    t = out.vertices[out.faces]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    centre = np.repeat([b.center for b in boxes], 12, axis=0)
    assert np.all(np.einsum("ij,ij->i", n, t.mean(axis=1) - centre) > 0)


def test_a_layer_drawn_as_one_face_becomes_the_front_face_of_its_plate_box():
    from benchmarks.bras.bras_geometry import SceneMesh, box, box_scene_mesh, object_boxes

    pv, pf = box((-0.047, -0.5, 0.5), (-0.022, 0.5, 1.5))
    lv, lf = box((-0.02, -0.5, 0.5), (0.0, 0.5, 1.5))      # the extruded absorber slab, 2 mm in front
    v, f = np.vstack([pv, lv]), np.vstack([pf, lf + 8])
    mats = ["mdf"] * 12 + ["rockfon"] * 12
    mesh = SceneMesh(v, f, mats, mats, v.min(axis=0), v.max(axis=0))
    boxes = object_boxes(mesh, layers={"rockfon": (-0.020, 0.0, 0.0)})
    assert len(boxes) == 1 and boxes[0].parts == 2 and boxes[0].face_materials == {(0, 1): "rockfon"}
    np.testing.assert_allclose(2 * boxes[0].half, [0.047, 1.0, 1.0], atol=1e-9)
    out = box_scene_mesh(mesh, boxes)
    tri = out.vertices[out.faces[np.asarray(out.materials) == "rockfon"]]
    assert tri.shape == (2, 3, 3) and np.allclose(tri[..., 0], 0.0)            # the drawn face, at x = 0
    assert np.cross(tri[0, 1] - tri[0, 0], tri[0, 2] - tri[0, 0])[0] > 0       # facing away from the plate


def test_lift_raises_only_the_boxes_standing_on_the_floor():
    from benchmarks.bras.bras_geometry import lift_boxes, object_boxes

    boxes = object_boxes(_slotted_plate_and_battens())
    lifted = lift_boxes(boxes, 0.0, 0.005)
    assert all(abs(b2.corners()[:, 2].min() - 0.005) < 1e-9 for b2 in lifted)
    floating = lift_boxes([type(boxes[0])(**{**boxes[0].__dict__, "center": boxes[0].center + [0, 0, 1.0]})], 0.0, 0.005)
    assert abs(floating[0].corners()[:, 2].min() - 1.0) < 1e-9


def test_the_geometric_scene_does_not_depend_on_the_fmax_stage():
    from benchmarks.bras.bras_benchmark import load_scene, options_from_env, plan_run
    from benchmarks.bras.scenes import SCENES, missing_inputs

    scene = SCENES["RS6"]
    if missing_inputs(scene):
        pytest.skip("BRAS inputs not on this machine")
    data = load_scene(scene)
    plans = []
    for fmax in scene.band_test.stages:
        opts = options_from_env(data)
        opts = type(opts)(**{**opts.__dict__, "fmax": float(fmax), "ppw": scene.band_test.stages[fmax]})
        plans.append(plan_run(data, opts))
    assert plans[0].bounds != plans[1].bounds or plans[0].domain.h != plans[1].domain.h
    assert bras_pra._hash(plans[0].ga, plans[0].ga_geo, plans[0].ga_pairs_data) == \
        bras_pra._hash(plans[1].ga, plans[1].ga_geo, plans[1].ga_pairs_data)
    assert len(plans[0].ga_boxes) == 1
