# backend/tests/test_pffdtd_job_bounds.py
"""Padded simulation domain (open scenes) -- CPU only, no GPU or compas-pffdtd needed.

``domain_bounds`` lets a reflector stand in free field with its sources/receivers outside its
bounding box: ``plan_grid`` keeps h aligned to the geometry and sizes the grid from the padded
domain, ``resolve_domain_bounds`` validates the bounds, and the job JSON carries bmin/bmax.
"""

import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

import services.pffdtd_job as pffdtd_job  # noqa: E402
from services.pffdtd_job import resolve_domain_bounds  # noqa: E402
from utils.pffdtd_grid import plan_grid  # noqa: E402

CUBE = 0.5
ABSORPTION = {"coeffs": [0.05] * 6, "center_freqs": [125, 250, 500, 1000, 2000, 4000]}
SOURCE = [-1.5, 0.25, 0.25]
RECEIVER = [-1.5, 2.0, 0.25]


def _cube_geometry():
    s = CUBE
    v = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]]
    quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    faces = [t for a, b, c, d in quads for t in ([a, b, c], [a, c, d])]
    return {"vertices": v, "faces": faces, "object_face_ranges": {"cube": [0, len(faces) - 1]},
            "face_materials": {i: ABSORPTION for i in range(len(faces))}}


def _pairs():
    return [{"source_id": "s1", "source_position": SOURCE, "receiver_id": "r1", "receiver_position": RECEIVER}]


def test_plan_grid_domain_extents_keeps_h_and_grows_grid():
    base = plan_grid([CUBE] * 3, 500.0, 12.0, 0.05)
    padded = plan_grid([CUBE] * 3, 500.0, 12.0, 0.05, domain_extents=[5.5, 5.5, 5.5])
    assert padded.h == base.h
    assert padded.misalignment_cells == base.misalignment_cells
    assert padded.nodes > 100 * base.nodes
    assert padded.as_dict()["domain_extents"] == [5.5, 5.5, 5.5]
    assert base.as_dict()["domain_extents"] is None


def test_plan_grid_explicit_h_is_kept():
    plan = plan_grid([CUBE] * 3, 500.0, 12.0, 0.05, domain_extents=[5.5] * 3, h=0.05)
    assert plan.h == 0.05 and plan.misalignment_cells == pytest.approx([0.0] * 3, abs=1e-9)
    assert plan.ppw_effective == pytest.approx(343.2 / (500.0 * 0.05))
    odd = plan_grid([CUBE] * 3, 500.0, 12.0, 0.05, h=0.03)
    assert odd.misalignment_cells == pytest.approx([1.0 / 3.0] * 3, abs=1e-9)


def test_resolve_domain_bounds_validation():
    bmin, bmax = np.zeros(3), np.full(3, CUBE)
    assert resolve_domain_bounds(bmin, bmax, [SOURCE], None) is None
    dmin, dmax = resolve_domain_bounds(bmin, bmax, [SOURCE, RECEIVER], ([-2.5] * 3, [3.0] * 3))
    assert dmin.tolist() == [-2.5] * 3 and dmax.tolist() == [3.0] * 3
    with pytest.raises(RuntimeError, match="outside the domain"):
        resolve_domain_bounds(bmin, bmax, [[-3.0, 0, 0]], ([-2.5] * 3, [3.0] * 3))
    with pytest.raises(RuntimeError, match="do not enclose"):
        resolve_domain_bounds(bmin, bmax, [], ([0.1] * 3, [3.0] * 3))


class _Captured(Exception):
    pass


@pytest.mark.parametrize("bounds", [None, ([-2.5, -2.5, -2.5], [3.0, 3.0, 3.0])])
def test_job_carries_domain_bounds(tmp_path, monkeypatch, bounds):
    captured = {}

    def fake_run_pipeline_job(job, work_dir, progress_file):
        captured.update(job)
        raise _Captured

    monkeypatch.setattr(pffdtd_job, "run_pipeline_job", fake_run_pipeline_job)
    sim_id = f"test_bounds_{'padded' if bounds else 'bbox'}"
    try:
        with pytest.raises(_Captured):
            pffdtd_job._run_from_geometry(
                sim_id, str(tmp_path / "progress.json"), str(tmp_path / "result.json"), _cube_geometry(),
                _pairs() if bounds else [{**_pairs()[0], "source_position": [0.25, 0.25, 0.25]}],
                "mono", 500.0, 12.0, 0.05, True, "bounds-test", str(tmp_path), str(tmp_path), None,
                domain_bounds=bounds,
            )
    finally:
        shutil.rmtree(Path(pffdtd_job.PFFDTD_TEMP_DIR) / sim_id, ignore_errors=True)
    if bounds is None:
        assert "bmin" not in captured and "bmax" not in captured
    else:
        assert captured["bmin"] == bounds[0] and captured["bmax"] == bounds[1]
