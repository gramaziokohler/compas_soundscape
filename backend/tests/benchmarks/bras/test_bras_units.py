"""CPU-only unit tests of the benchmark helpers (no BRAS data, no GPU)."""
import math

import h5py
import numpy as np
import pytest

from benchmarks.bras.bras_analysis import band_centres, edge_echo_delay_s, floor_delay_s, prepare_sim
from benchmarks.bras.bras_domain import alignment_box, gate_padding_m, padded_bounds
from benchmarks.bras.bras_geometry import (
    box,
    check_bbox,
    control_markers,
    geometry_dict,
    ground_mesh,
    load_scene_mesh,
    read_obj,
    resolve_material,
    to_zup,
)
from benchmarks.bras.bras_scene import (
    MeasuredPair,
    bras_forward,
    check_orientations,
    load_sofa_pairs,
    pair_geometry,
    segment_hits_mesh,
    yaw_pitch_from_forward,
)
from benchmarks.bras.bras_signal import band_levels_db, fractional_shift, half_hann_window, smooth_db, spectrum, xcorr_lag_s
from benchmarks.bras.scenes import SCENES, BandTest, GeometryInput, MaterialInput, SourceInput, get_scene
from config.constants import AUDIO_SAMPLE_RATE
from utils.orientation import forward_vector

LS = {"LS1": [3.46, 2.0, 1.02], "LS2": [2.83, 2.83, 1.02], "LS3": [2.0, 3.46, 1.02],
      "LS4": [3.46, -2.0, 1.02], "LS5": [2.83, -2.83, 1.02], "LS6": [2.0, -3.46, 1.02]}
MP = {"MP1": [3.46, -2.0, 1.02], "MP4": [-0.71, -0.71, 1.02], "MP5": [-0.71, 0.71, 1.02]}
PLATE = (np.array([-0.027, -0.5, 0.52]), np.array([-0.002, 0.5, 1.52]))
RS2_SRC = SourceInput(directivity="x.csv", aim_point=(0.0, 0.0, 1.02),
                      orientations={"LS1": (-150, 0), "LS4": (150, 0), "LS6": (120, 0)})


def _pair(ls, mp):
    return MeasuredPair(ls, mp, np.asarray(LS[ls]), np.asarray(MP[mp]), np.zeros(10), 44100.0)


def _write_obj(path, quads_by_label, key="usemtl"):
    lines, verts = [], []
    for label, (lo, hi) in quads_by_label.items():
        v, f = box(lo, hi)
        base = len(verts)
        verts += v.tolist()
        lines.append(f"{key} {label}" if key == "usemtl" else f"g {label}")
        lines += [f"f {a + base + 1} {b + base + 1} {c + base + 1}" for a, b, c in f]
    path.write_text("\n".join([f"v {x} {y} {z}" for x, y, z in verts] + lines))


def test_scene_registry():
    assert get_scene("RS2_1m_rigid").gain_pair in get_scene("RS2_1m_rigid").smoke_pairs
    for sc in SCENES.values():
        assert sc.gain_pair and sc.band_test.stages and "*" in sc.materials
    with pytest.raises(KeyError):
        get_scene("nope")


def test_obj_labels_and_multi_material(tmp_path):
    obj = tmp_path / "plate.obj"
    _write_obj(obj, {"MDF_core": ((0, 0, 0), (1, 0.025, 1)), "RockFon_face": ((0, 0.025, 0), (1, 0.045, 1))})
    v, f, tags = read_obj(obj)
    assert f.shape == (24, 3) and tags["usemtl"].count("MDF_core") == 12
    mats = {"*RockFon*": MaterialInput(alpha=0.9), "*": MaterialInput(alpha=0.02)}
    mesh = load_scene_mesh(GeometryInput(obj=obj, up_axis="z"), mats)
    assert mesh.materials.count("*RockFon*") == 12 and mesh.materials.count("*") == 12
    geo = geometry_dict([(mesh.vertices, mesh.faces, mesh.materials)], {"*RockFon*": {"c": 1}, "*": {"c": 2}})
    assert sorted(geo["object_face_ranges"]) == ["*", "*RockFon*"] and len(geo["face_materials"]) == 24
    with pytest.raises(ValueError, match="no material pattern"):
        load_scene_mesh(GeometryInput(obj=obj, up_axis="z"), {"*RockFon*": MaterialInput(alpha=0.9)})
    assert resolve_material("rockfon_face", ["*", "*RockFon*"]) == "*RockFon*"  # specific first, case-insensitive


def test_obj_groups_and_yup(tmp_path):
    obj = tmp_path / "g.obj"
    _write_obj(obj, {"plate": ((-0.027, 0.52, -0.5), (-0.002, 1.52, 0.5))}, key="g")
    mesh = load_scene_mesh(GeometryInput(obj=obj, material_key="group", expected_bbox=tuple(map(tuple, PLATE))),
                           {"plate": MaterialInput(alpha=0.02)})
    assert np.allclose(mesh.bmin, PLATE[0]) and np.allclose(mesh.bmax, PLATE[1])
    with pytest.raises(ValueError):
        check_bbox(*to_zup(np.array([[-0.027, 0.52, -0.5], [-0.002, 1.52, 0.5]]), "z"), PLATE)


def test_orientations_and_line_of_sight():
    sources = {k: np.asarray(LS[k]) for k in ("LS1", "LS4", "LS6")}
    check_orientations(sources, RS2_SRC)
    bad = SourceInput(directivity="x.csv", aim_point=(0.0, 0.0, 1.02), orientations={"LS1": (-120, 0)})
    with pytest.raises(AssertionError):
        check_orientations({"LS1": np.asarray(LS["LS1"])}, bad)
    f = bras_forward(-150, 0)
    assert np.allclose(forward_vector(*yaw_pitch_from_forward(f)), f)
    v, faces = box(*PLATE)
    g = pair_geometry(_pair("LS1", "MP1"), v, faces, RS2_SRC, 342.0)
    assert g.line_of_sight and g.offaxis_direct_deg == pytest.approx(60.0, abs=0.2)
    assert pair_geometry(_pair("LS4", "MP4"), v, faces, RS2_SRC, 342.0).line_of_sight
    assert not pair_geometry(_pair("LS6", "MP5"), v, faces, RS2_SRC, 342.0).line_of_sight
    assert not segment_hits_mesh([1, 0, 1], [2, 0, 1], v, faces)


def test_sofa_loader_skips_missing_and_rejects_fire(tmp_path):
    path = tmp_path / "rs.sofa"
    with h5py.File(path, "w") as f:
        ir = np.ones((3, 1, 32))
        ir[1] = 0.0  # a missing measurement
        f["Data.IR"] = ir
        f["Data.SamplingRate"] = np.array([44100.0])
        f["EmitterPosition"] = np.array([LS["LS1"], LS["LS2"], LS["LS4"]]).T[None]
        f["ReceiverPosition"] = np.array([MP["MP1"], MP["MP1"], MP["MP5"]]).T[None]
        f["EmitterID"] = np.array([[1.0], [2.0], [4.0]])
        f["ReceiverID"] = np.array([[1.0], [1.0], [5.0]])
    pairs = load_sofa_pairs(path)
    assert [p.key for p in pairs] == ["LS1-MP1", "LS4-MP5"]
    assert np.allclose(pairs[1].receiver_position, MP["MP5"])
    fire = tmp_path / "cr.sofa"
    with h5py.File(fire, "w") as f:
        f["Data.IR"] = np.ones((2, 2, 2, 8))
    with pytest.raises(ValueError, match="GeneralFIR"):
        load_sofa_pairs(fire)


def test_domain_bounds_with_and_without_ground():
    assert gate_padding_m(6.92, 0.017, 343.2) == pytest.approx(5.36, abs=0.02)
    h = 0.025
    pts = np.array([LS["LS1"], MP["MP4"], LS["LS6"]])
    bmin, bmax = padded_bounds(*PLATE, pts, h, 3.0)
    for b, p in ((bmin, PLATE[0]), (bmax, PLATE[1])):
        cells = (np.asarray(b) - p) / h
        assert np.allclose(cells, np.round(cells), atol=1e-9)
    lo, hi = alignment_box(np.array([0.0, 0.0, 0.0]), np.array([0.12, 4.1, 0.24]), 0.0)
    gmin, gmax = padded_bounds(lo, hi, np.array([[2.0, 1.0, 1.2]]), h, 2.0, ground_z=0.0)
    assert gmin[2] == pytest.approx(-2 * h) and gmax[2] >= 1.2 + 2.0
    with pytest.raises(ValueError):
        alignment_box(np.array([0.0, 0.0, 0.0]), np.ones(3), 0.5)
    gv, gf = ground_mesh(gmin, gmax, 0.0, h)
    assert gv[:, 0].min() == pytest.approx(gmin[0] + h) and gv[:, 1].max() == pytest.approx(gmax[1] - h) and len(gf) == 2
    mv, _ = control_markers(*PLATE)
    assert np.allclose(mv.min(axis=0), PLATE[0]) and np.allclose(mv.max(axis=0), PLATE[1])


def test_band_centres():
    bt = BandTest(fmin_hz=100.0, fmax_fraction=0.8, bands_per_octave=3)
    assert band_centres(bt, 500.0) == [100, 125, 160, 200, 250, 315, 400]
    assert band_centres(BandTest(bands_per_octave=1), 2000.0) == [125, 250, 500, 1000]
    assert band_centres(bt, 2000.0)[-1] == 1600


def test_signal_primitives():
    fs = 44100.0
    w = half_hann_window(1000, fs, 0.005, 0.01, 0.001, 0.002)
    t = np.arange(1000) / fs
    assert w[(t >= 0.005) & (t <= 0.01)].min() == 1.0 and w[t < 0.004].max() == 0.0 and w[t > 0.0121].max() == 0.0
    x = np.zeros(2048)
    x[100] = 1.0
    f, H = spectrum(x, fs)
    assert np.allclose(band_levels_db(f, H, [125, 1000], 3), 0.0, atol=1e-9)
    assert np.allclose(smooth_db(f, H, 12, np.array([200.0, 2000.0])), 0.0, atol=1e-9)
    k = np.arange(600) - 300.0
    a = np.sinc(k / 8.0) * np.exp(-((k / 60.0) ** 2))  # band-limited pulse, quiet ends (like a direct sound)
    b = fractional_shift(a, 3.3 / fs, fs)
    assert xcorr_lag_s(a, b, fs, 0.001) * fs == pytest.approx(3.3, abs=0.05)
    assert np.abs(fractional_shift(b, -3.3 / fs, fs)[50:-50] - a[50:-50]).max() < 1e-3 * np.abs(a).max()


def _impulses(n, fs, items):
    x = np.zeros(n)
    for t, amp in items:
        x[int(round(t * fs))] = amp
    return x


def test_edge_echo_removal_keeps_the_floor_reflection():
    c, fs, n = 343.2, AUDIO_SAMPLE_RATE, 4800
    src, rcv = np.array([0.0, 0.0, 1.0]), np.array([2.0, 0.0, 1.0])
    bmin, bmax = np.array([-1.0, -3.0, -0.05]), np.array([3.0, 3.0, 4.0])
    echo = edge_echo_delay_s(src, rcv, bmin, bmax, ground_z=0.0, c=c)
    assert echo == pytest.approx((4.0 - 2.0) / c)                 # x = -1 face; the face under the floor is shielded
    assert edge_echo_delay_s(src, rcv, bmin, bmax, c=c) < echo     # unshielded, the bottom face would be nearest
    floor = floor_delay_s(src, rcv, 0.0, c)
    assert floor == pytest.approx((math.hypot(2.0, 2.0) - 2.0) / c)
    t_d = 2.0 / c
    direct_and_floor = [(t_d, 1.0), (t_d + floor, 0.7)]
    edge = [(t_d + echo, -0.3)]
    scatter = [(t_d + 0.0015, 0.5)]                                # only the scene run has the object
    sim = _impulses(n, fs, direct_and_floor + edge + scatter)
    ctl = _impulses(n, fs, direct_and_floor + edge)
    out = prepare_sim(sim, ctl, 2.0, echo, 4000, physical_delay_s=floor)
    ref = prepare_sim(_impulses(n, fs, direct_and_floor + scatter), None, 2.0, echo, 4000)
    assert np.abs(out - ref).max() < 1e-9
