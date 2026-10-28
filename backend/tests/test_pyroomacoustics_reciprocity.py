# backend/tests/test_pyroomacoustics_reciprocity.py
"""Source/listener swap (utils/reciprocity.py) and its use by the pyroomacoustics worker."""

import json

import numpy as np
import pytest
from scipy.io import wavfile

import config.constants as constants
import services.pyroomacoustics_worker as worker
from utils.reciprocity import decide_reciprocity, group_pairs_by_emitter


def _pair(s, r, directivity=None):
    return {
        "source_id": s, "receiver_id": r,
        "source_position": [1, 1, 1], "receiver_position": [2, 2, 1],
        "source_directivity_spec": directivity,
    }


class TestDecision:
    def test_more_sources_than_listeners_flips(self):
        pairs = [_pair(f"s{i}", "r1") for i in range(3)]
        d = decide_reciprocity(pairs, "mono")
        assert d.flipped and (d.n_sources, d.n_receivers) == (3, 1)

    @pytest.mark.parametrize("n_sources,n_receivers", [(1, 1), (2, 2), (1, 3), (2, 3)])
    def test_not_more_sources_keeps_the_roles(self, n_sources, n_receivers):
        pairs = [_pair(f"s{i}", f"r{j}") for i in range(n_sources) for j in range(n_receivers)]
        assert not decide_reciprocity(pairs, "mono").flipped

    def test_ambisonic_listeners_are_never_swapped(self):
        pairs = [_pair(f"s{i}", "r1") for i in range(5)]
        assert not decide_reciprocity(pairs, "foa").flipped

    def test_directional_sources_are_never_swapped(self):
        pairs = [_pair("s1", "r1", {"id": "cardioid"})] + [_pair(f"s{i}", "r1") for i in range(2, 5)]
        assert not decide_reciprocity(pairs, "mono").flipped

    def test_can_be_disabled(self):
        pairs = [_pair(f"s{i}", "r1") for i in range(3)]
        assert not decide_reciprocity(pairs, "mono", enabled=False).flipped


def test_grouping_follows_the_emitter():
    pairs = [_pair("s1", "r1"), _pair("s2", "r1"), _pair("s1", "r2")]
    assert {k: len(v) for k, v in group_pairs_by_emitter(pairs, False).items()} == {"s1": 2, "s2": 1}
    assert {k: len(v) for k, v in group_pairs_by_emitter(pairs, True).items()} == {"r1": 2, "r2": 1}


def _l_room():
    outline = [(0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10)]
    n, h = len(outline), 3.0
    v = [[x, y, 0] for x, y in outline] + [[x, y, h] for x, y in outline]
    f = []
    for i in range(n):
        j = (i + 1) % n
        f += [[i, j + n, j], [i, i + n, j + n]]
    fan = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]]
    f += [[a, b, c] for a, b, c in fan]
    f += [[a + n, c + n, b + n] for a, b, c in fan]
    return v, f


def _run(tmp_path, name, ray_tracing, n_rays=3000):
    v, f = _l_room()
    out = tmp_path / name
    out.mkdir()
    payload = {
        "vertices": v, "faces": f,
        "face_groups": {"room": list(range(len(f)))},
        "materials": {"room": {"absorption": 0.2}},
        "sources": [{"id": "s1", "position": [1, 7, 1.5]}, {"id": "s2", "position": [8, 2, 1.5]},
                    {"id": "s3", "position": [2, 2, 1.2]}],
        "receivers": [{"id": "r1", "position": [3, 8, 1.5]}],
    }
    (out / "geometry.json").write_text(json.dumps(payload))
    worker.run_pyroomacoustics_simulation_from_geometry(
        simulation_id=name, progress_file=str(out / "p.json"), result_file=str(out / "r.json"),
        geometry_file=str(out / "geometry.json"), simulation_mode="mono", max_order=2,
        ray_tracing=ray_tracing, air_absorption=False, n_rays=n_rays, sound_speed=343.0,
        simulation_name=name, rir_output_dir=str(out), temp_dir=str(out),
    )
    result = json.loads((out / "r.json").read_text())
    assert result["type"] == "done", result.get("traceback")
    results = json.loads((out / result["result"]["results_file"]).read_text())
    irs = {}
    for entry in results["results"]:
        _, ir = wavfile.read(str(out / entry["ir_file"]))
        irs[(entry["source_id"], entry["receiver_id"])] = ir.astype(np.float64)
    return results, irs


def test_swapped_image_source_irs_equal_the_direct_ones(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "PYROOMACOUSTICS_RECIPROCITY_ENABLED", False)
    direct, ir_direct = _run(tmp_path, "direct", ray_tracing=False)
    monkeypatch.setattr(worker, "PYROOMACOUSTICS_RECIPROCITY_ENABLED", True)
    swapped, ir_swapped = _run(tmp_path, "swapped", ray_tracing=False)

    assert not direct["reciprocity"]["flipped"] and swapped["reciprocity"]["flipped"]
    assert ir_direct.keys() == ir_swapped.keys() == {("s1", "r1"), ("s2", "r1"), ("s3", "r1")}
    for key, a in ir_direct.items():
        b = ir_swapped[key]
        n = min(len(a), len(b))
        assert abs(len(a) - len(b)) < 200  # same trim point, give or take a few samples
        assert np.corrcoef(a[:n], b[:n])[0, 1] > 0.98
    entry = next(e for e in swapped["results"] if e["source_id"] == "s2")
    assert entry["source_position"] == [8, 2, 1.5] and entry["receiver_position"] == [3, 8, 1.5]


def test_swapped_hybrid_run_with_several_ray_processes(tmp_path, monkeypatch):
    monkeypatch.setattr(constants, "PYROOMACOUSTICS_MAX_PROCESSES", 2)
    monkeypatch.setattr(worker, "PYROOMACOUSTICS_RECIPROCITY_ENABLED", False)
    _, ir_direct = _run(tmp_path, "direct", ray_tracing=True)
    monkeypatch.setattr(worker, "PYROOMACOUSTICS_RECIPROCITY_ENABLED", True)
    swapped, ir_swapped = _run(tmp_path, "swapped", ray_tracing=True)

    assert swapped["reciprocity"]["flipped"]
    for key, a in ir_direct.items():
        b = ir_swapped[key]
        # Same total energy within the Monte-Carlo noise of the ray-traced tail
        assert abs(10 * np.log10((a ** 2).sum() / (b ** 2).sum())) < 3.0
