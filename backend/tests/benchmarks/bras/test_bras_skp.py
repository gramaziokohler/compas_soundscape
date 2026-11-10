"""SKP input: label parsing, extrusion, label positions (CPU); reading a real BRAS model when available."""
import numpy as np
import pytest

from benchmarks.bras.bras_geometry import extrude, load_scene_mesh, triangle_areas
from benchmarks.bras.bras_scene import MeasuredPair, apply_label_positions
from benchmarks.bras.bras_skp import parse_labels, skp_available
from benchmarks.bras.scenes import SCENES, missing_inputs

TEXTS = [
    "LS01_Genelec8020c\npos= (2902,2985,1520) mm; (ϕ,θ)=(0°,-30°)",
    "LS04_Genelec8020c\npos= (3460,-2000,1020) mm; (ϕ,θ)=(150°,0°)\n\nMP01_GRAS40AF\npos= (3460,-2000,1020) mm",
    "LS05_Genelec8020c\npos= (2690,2350,930 mm; (ϕ,θ)=(-135°,0°)",          # bracket missing in RS4
    "MP04_GRAS40AF (only for LS02)\npos= (8098,2985,1573) mm (Pos. FABIAN)",
    "LS04_Genelec8020c\npos= (2487,2985,135) mm; (ϕ,θ)=(0°,34.6°)",
    "Reflection point\npos = (5500,2985,20) mm ",
    "hard \nreflecting \nfloor (Tiles)",
]


def test_parse_labels():
    labels, refl = parse_labels(TEXTS[:4] + TEXTS[5:])
    assert sorted(labels) == ["LS1", "LS4", "LS5", "MP1", "MP4"]
    assert labels["LS1"].orientation == (0.0, -30.0) and np.allclose(labels["LS1"].position, [2.902, 2.985, 1.52])
    assert labels["LS4"].orientation == (150.0, 0.0) and labels["MP1"].orientation is None
    assert np.allclose(labels["MP1"].position, [3.46, -2.0, 1.02])
    assert np.allclose(labels["LS5"].position, [2.69, 2.35, 0.93]) and labels["LS5"].orientation == (-135.0, 0.0)
    assert np.allclose(labels["MP4"].position, [8.098, 2.985, 1.573])
    assert np.allclose(refl, [5.5, 2.985, 0.02])
    assert parse_labels([TEXTS[4]])[0]["LS4"].orientation == (0.0, 34.6)


def test_extrude_closes_a_sheet():
    v = np.array([[0.0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]])
    f = np.array([[0, 1, 2], [0, 2, 3]])
    ev, ef = extrude(v, f, (-0.02, 0.0, 0.0))
    assert len(ev) == 8 and len(ef) == 2 + 2 + 8
    assert triangle_areas(ev, ef).sum() == pytest.approx(2 * 1.0 + 4 * 0.02)
    edges = np.sort(np.vstack([ef[:, [0, 1]], ef[:, [1, 2]], ef[:, [2, 0]]]), axis=1)
    assert (np.unique(edges, axis=0, return_counts=True)[1] == 2).all()   # watertight


def test_label_positions_replace_sofa_positions():
    from benchmarks.bras.bras_skp import SkpLabel

    labels = {"LS1": SkpLabel("LS", "LS1", "x", np.array([1.0, 0, 1.5]), (0.0, 0.0)),
              "MP1": SkpLabel("MP", "MP1", "x", np.array([4.0, 0, 1.74]))}
    pair = MeasuredPair("LS1", "MP1", np.array([1.0, 0, 1.5]), np.array([4.0, 0, 1.5]), np.ones(4), 44100.0)
    out, notes = apply_label_positions([pair, pair], labels)
    assert np.allclose(out[0].receiver_position, [4.0, 0, 1.74]) and np.allclose(out[0].source_position, [1.0, 0, 1.5])
    assert [n["id"] for n in notes] == ["MP1"] and notes[0]["deviation_m"] == pytest.approx(0.24)
    with pytest.raises(KeyError):
        apply_label_positions([MeasuredPair("LS2", "MP1", pair.source_position, pair.receiver_position, pair.ir, 44100.0)], labels)


def _skip_unless_readable(name: str):
    if skp_available() is not None:
        pytest.skip(skp_available())
    if missing_inputs(SCENES[name]):
        pytest.skip(f"{name}: BRAS files not on this machine")
    return SCENES[name]


def test_read_rs2_plate_matches_the_documented_geometry():
    scene = _skip_unless_readable("RS2_1m_rigid")
    mesh = load_scene_mesh(scene.geometry, scene.materials)   # expected_bbox is checked inside
    assert len(mesh.faces) == 24 and set(mesh.labels) == {"MDF12mm"}
    # both faces and the rim, minus two 1 m x 2 cm strips on the back where the frame sits (as in the OBJ export)
    assert triangle_areas(mesh.vertices, mesh.faces).sum() == pytest.approx(2.06, abs=1e-6)
    assert "(no material)" in mesh.dropped                    # the supporting structure is left out
    labels = mesh.skp.labels
    assert len([k for k in labels if k.startswith("LS")]) == 6 and labels["LS1"].orientation == (-150.0, 0.0)
    assert np.allclose(mesh.skp.reflection_point, [0.0, 0.0, 1.02])


def test_hidden_objects_are_not_read():
    scene = _skip_unless_readable("RS1_rigid")
    mesh = load_scene_mesh(scene.geometry, scene.materials)
    assert mesh.empty and mesh.skp.hidden_faces > 1000         # the absorber and the diffusor are hidden there
    assert np.allclose(mesh.bmin, scene.geometry.empty_bbox[0])
