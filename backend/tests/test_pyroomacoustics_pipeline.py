# backend/tests/test_pyroomacoustics_pipeline.py
"""End-to-end run of the direct-geometry pyroomacoustics worker.

An inward-wound L-shaped room with a free-standing panel exercises the whole
chain (prepare → merge → two-sided walls → compute_rir → IR export) and checks
that the geometry diagnostics are written into the results JSON.
"""

import json

import numpy as np
from scipy.io import wavfile

from services.pyroomacoustics_worker import run_pyroomacoustics_simulation_from_geometry


def _l_room_inward():
    outline = [(0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10)]
    n, h = len(outline), 3.0
    v = [[x, y, 0] for x, y in outline] + [[x, y, h] for x, y in outline]
    f = []
    for i in range(n):
        j = (i + 1) % n
        f += [[i, j + n, j], [i, i + n, j + n]]          # inward walls
    fan = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]]
    f += [[a, b, c] for a, b, c in fan]                    # inward floor
    f += [[a + n, c + n, b + n] for a, b, c in fan]        # inward ceiling
    return v, f


def test_geometry_worker_end_to_end(tmp_path):
    v, f = _l_room_inward()
    base = len(v)
    v += [[2, 6, 0.5], [2, 8, 0.5], [2, 8, 2.5], [2, 6, 2.5]]  # free-standing panel
    f += [[base, base + 1, base + 2], [base, base + 2, base + 3]]
    room_faces = list(range(len(f) - 2))
    payload = {
        "vertices": v,
        "faces": f,
        "face_groups": {"room": room_faces, "panel": [len(f) - 2, len(f) - 1]},
        "materials": {"room": {"absorption": 0.2}, "panel": {"absorption": 0.1}},
        "sources": [{"id": "s1", "position": [1, 7, 1.5]}],
        "receivers": [{"id": "r1", "position": [3, 7, 1.5]}, {"id": "r2", "position": [8, 2, 1.5]}],
    }
    geometry_file = tmp_path / "geometry.json"
    geometry_file.write_text(json.dumps(payload))
    progress_file = tmp_path / "progress.json"
    result_file = tmp_path / "result.json"

    run_pyroomacoustics_simulation_from_geometry(
        simulation_id="test",
        progress_file=str(progress_file),
        result_file=str(result_file),
        geometry_file=str(geometry_file),
        simulation_mode="mono",
        max_order=2,
        ray_tracing=False,
        air_absorption=False,
        n_rays=1000,
        sound_speed=343.0,
        simulation_name="pipeline",
        rir_output_dir=str(tmp_path),
        temp_dir=str(tmp_path),
    )

    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("traceback")
    results = json.loads((tmp_path / result["result"]["results_file"]).read_text())
    diag = results["geometry_diagnostics"]
    assert diag["stats"]["flipped_faces"] > 0          # inward room was re-oriented
    assert diag["stats"]["two_sided_faces"] == 2       # panel reflects on both sides
    assert diag["stats"]["simulated_walls"] < 20       # coplanar merge
    assert diag["n_errors"] == 0

    for name in result["result"]["ir_files"]:
        _, ir = wavfile.read(str(tmp_path / name))
        assert np.abs(ir).max() > 0
        # Reflections exist: more than a lone direct-path spike.
        assert np.count_nonzero(np.abs(ir) > 0.01 * np.abs(ir).max()) > 50
