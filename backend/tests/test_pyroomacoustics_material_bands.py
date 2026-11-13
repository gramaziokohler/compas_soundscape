"""Material coefficients reach pyroomacoustics' octave bands by frequency, not by position."""
import numpy as np
import pyroomacoustics as pra

from services.pyroomacoustics_room_builder import _absorption_bands, _fit_bands, _n_bands, _octave_centres

N = _n_bands(48000)


def test_third_octave_data_is_averaged_per_octave():
    # 1/3-octave bands from 20 Hz (the BRAS material format): alpha = band index / 100
    f = 1000.0 * 2.0 ** (np.arange(-17, 14) / 3.0)
    f[np.isclose(f, 1000.0)] = 1000.0
    coeffs = np.arange(len(f)) / 100.0
    got = _absorption_bands({"coeffs": coeffs.tolist(), "center_freqs": f.tolist()}, N)[0]
    for fc, a in zip(_octave_centres(N), got):
        inside = (f >= fc / np.sqrt(2)) & (f < fc * np.sqrt(2))
        assert inside.sum() == 3
        assert np.isclose(a, coeffs[inside].mean())
    assert got[0] > 0.05   # not the 20 Hz value (0.0): the old positional mapping


def test_octave_materials_map_unchanged():
    for name in ("rough_concrete", "carpet_cotton", "hard_surface"):
        old = _fit_bands(pra.Material(energy_absorption=name).energy_absorption["coeffs"], N)
        assert np.allclose(_absorption_bands(name, N)[0], old)
    custom = {"coeffs": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], "center_freqs": [125, 250, 500, 1000, 2000, 4000, 8000]}
    assert np.allclose(_absorption_bands(custom, N)[0], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.7])


def test_gaps_are_interpolated_and_edges_held():
    got = _absorption_bands({"coeffs": [0.2, 0.8], "center_freqs": [250.0, 4000.0]}, N)[0]
    assert np.isclose(got[0], 0.2) and np.isclose(got[-1], 0.8)        # held beyond the range
    assert np.isclose(got[3], 0.2 + 0.6 * np.log2(1000 / 250) / np.log2(4000 / 250))  # 1 kHz on a log axis


def test_unreached_faces_are_always_kept_as_walls():
    """A face sealed inside a solid (a seam between two touching blocks) is classified as never
    reached, but stays a simulated wall: "unreached" is a stochastic observation and must never
    change which geometry is simulated."""
    from models.schemas import MeshPrepSettings
    from services.simulation_mesh_service import FACE_CLASS_SKIPPED, MeshPrepOptions, SimulationMeshService

    def box(lo, hi, inward):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]
        q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
        f = [t for a, b, c, d in q for t in ([a, b, c], [a, c, d])]
        return v, [t[::-1] for t in f] if inward else f

    rv, rf = box([0, 0, 0], [10, 8, 4], inward=True)          # the room
    bv, bf = box([4, 3, 0.5], [6, 5, 1.5], inward=False)      # a solid block
    seam = [[5, 3, 0.5], [5, 5, 0.5], [5, 5, 1.5], [5, 3, 1.5]]   # a face inside the block
    verts = rv + bv + seam
    faces = rf + [[a + 8, b + 8, c + 8] for a, b, c in bf] + [[16, 17, 18], [16, 18, 19]]
    ranges = {"room": [0, 11], "block": [12, 23], "seam": [24, 25]}
    mats = {i: {"coeffs": [0.1] * 7, "center_freqs": [125, 250, 500, 1000, 2000, 4000, 8000]} for i in range(26)}
    seeds = [[1.0, 1.0, 2.0], [9.0, 7.0, 2.0]]
    # A legacy payload with the removed key still parses (extra keys are ignored).
    settings = MeshPrepSettings.model_validate({"drop_unreached_faces": True})
    mesh = SimulationMeshService.prepare(verts, faces, ranges, mats, None, seeds,
                                         MeshPrepOptions.from_settings(settings))
    seam_faces = [f for f in range(len(mesh.faces)) if mesh.objects[mesh.face_object[f]] == "seam"]
    assert seam_faces and all(mesh.face_class[f] == FACE_CLASS_SKIPPED for f in seam_faces)
    in_walls = {int(f) for w in mesh.walls for f in w.faces}
    assert set(seam_faces) <= in_walls
    assert in_walls == set(range(len(mesh.faces)))
    assert "unreached_faces_dropped" not in mesh.stats
