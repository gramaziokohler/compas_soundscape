# backend/tests/test_pyroomacoustics_parallel.py
"""Emitter rooms in parallel processes (services/pyroomacoustics_worker.py)."""

import json
import multiprocessing

import numpy as np
import pytest
from scipy.io import wavfile

import config.constants as constants
import services.pyroomacoustics_worker as worker
from services.pyroomacoustics_worker import split_processes
from tests.test_pyroomacoustics_reciprocity import _l_room


@pytest.mark.parametrize(
    "max_processes,n_emitters,expected",
    [(8, 1, (1, 8)), (8, 2, (2, 4)), (8, 3, (3, 2)), (8, 8, (8, 1)), (8, 20, (8, 1)), (1, 5, (1, 1))],
)
def test_split_processes(max_processes, n_emitters, expected):
    assert split_processes(max_processes, n_emitters) == expected


def _payload():
    v, f = _l_room()
    return {
        "vertices": v, "faces": f,
        "face_groups": {"room": list(range(len(f)))},
        "materials": {"room": {"absorption": 0.2}},
        "sources": [{"id": "s1", "position": [1, 7, 1.5]}, {"id": "s2", "position": [8, 2, 1.5]}],
        "receivers": [{"id": "r1", "position": [3, 8, 1.5]}, {"id": "r2", "position": [2, 3, 1.2]}],
    }


def _run(out, parallel, ray_tracing=False):
    out.mkdir()
    (out / "geometry.json").write_text(json.dumps(_payload()))
    kwargs = dict(
        simulation_id=out.name, progress_file=str(out / "p.json"), result_file=str(out / "r.json"),
        geometry_file=str(out / "geometry.json"), simulation_mode="mono", max_order=2,
        ray_tracing=ray_tracing, air_absorption=False, n_rays=2000, sound_speed=343.0,
        simulation_name=out.name, rir_output_dir=str(out), temp_dir=str(out), parallel=parallel,
    )
    return kwargs


def _results(out):
    result = json.loads((out / "r.json").read_text())
    assert result["type"] == "done", result.get("traceback")
    results = json.loads((out / result["result"]["results_file"]).read_text())
    irs = {}
    for entry in results["results"]:
        _, ir = wavfile.read(str(out / entry["ir_file"]))
        irs[(entry["source_id"], entry["receiver_id"])] = ir
    return results, irs


def test_parallel_emitters_give_the_serial_image_source_irs(tmp_path, monkeypatch):
    monkeypatch.setattr(constants, "PYROOMACOUSTICS_MAX_PROCESSES", 2)
    worker.run_pyroomacoustics_simulation_from_geometry(**_run(tmp_path / "serial", parallel=False))
    worker.run_pyroomacoustics_simulation_from_geometry(**_run(tmp_path / "parallel", parallel=True))

    serial, ir_serial = _results(tmp_path / "serial")
    parallel, ir_parallel = _results(tmp_path / "parallel")
    pairs = [(e["source_id"], e["receiver_id"]) for e in serial["results"]]
    assert pairs == [(e["source_id"], e["receiver_id"]) for e in parallel["results"]]
    assert pairs == [("s1", "r1"), ("s1", "r2"), ("s2", "r1"), ("s2", "r2")]  # request order
    for key, a in ir_serial.items():
        assert np.array_equal(a, ir_parallel[key])
    assert not list((tmp_path / "parallel").glob("p.json.emitter*"))


def test_parallel_job_child_exits_when_done(tmp_path):
    """The CPU runner waits for its (daemonic) job child to exit: the pools must not keep it alive."""
    kwargs = _run(tmp_path / "child", parallel=True, ray_tracing=True)
    ctx = multiprocessing.get_context("spawn")
    process = ctx.Process(target=worker.run_pyroomacoustics_simulation_from_geometry, kwargs=kwargs, daemon=True)
    process.start()
    process.join(timeout=300)
    alive = process.is_alive()
    if alive:
        process.kill()
    assert not alive
    _results(tmp_path / "child")
