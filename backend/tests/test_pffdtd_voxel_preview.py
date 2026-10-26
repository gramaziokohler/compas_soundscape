# backend/tests/test_pffdtd_voxel_preview.py
"""PFFDTD voxel preview (mesh prep -> compas-pffdtd pipeline in voxel_preview mode).

Skipped unless the compas-pffdtd env (PFFDTD_PYTHON) and the built engine are present.
Checks the material legend and boundary-node points, the leak / reachability labelling
(closed vs open shoebox) and the seed clearance flag.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))  # shared shoebox fixtures

from services import pffdtd_preview_job as preview_job  # noqa: E402
from services.pffdtd_job import pffdtd_available  # noqa: E402
from services.pffdtd_preview_job import preview_paths, run_voxel_preview_from_geometry  # noqa: E402
from test_pffdtd_pipeline import FMAX, PPW, RECEIVER_X, SOURCE, _geometry, _pairs  # noqa: E402

pytestmark = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))


def _preview(tmp_path, geometry, pairs, tag):
    result_file = tmp_path / f"result_{tag}.json"
    run_voxel_preview_from_geometry(
        preview_id=f"00000000-0000-0000-0000-00000000000{tag}",
        progress_file=str(tmp_path / f"progress_{tag}.json"),
        result_file=str(result_file),
        geometry=geometry,
        pairs_data=pairs,
        fmax=FMAX,
        ppw=PPW,
        payload_dir=str(tmp_path),
    )
    result = json.loads(result_file.read_text())["result"]
    json_path, bin_path = preview_paths(str(tmp_path), result["preview_id"])
    return result, json.loads(json_path.read_text()), bin_path


def test_closed_shoebox_preview(tmp_path):
    result, preview, bin_path = _preview(tmp_path, _geometry(), _pairs(), "1")
    assert result["n_errors"] == 0 and result["n_warnings"] == 0, preview["problems"]
    assert preview["leak_check"]["done"] and not preview["leak_check"]["leak"]
    assert all(m["count"] > 0 and m["material_id"] for m in preview["materials"])
    n = preview["n_points"]
    assert 0 < n <= preview["grid"]["boundary_nodes"]
    raw = bin_path.read_bytes()
    assert len(raw) == n * 13
    pts = np.frombuffer(raw[: n * 12], np.float32).reshape(n, 3)
    # boundary nodes hug the 4 x 3 x 2.5 m box
    assert pts.min(axis=0).min() > -0.2 and (pts.max(axis=0) < np.array([4.2, 3.2, 2.7])).all()


def test_open_shoebox_leaks(tmp_path):
    geometry = _geometry()
    a, b = geometry["object_face_ranges"].pop("ceiling")
    keep = [i for i in range(len(geometry["faces"])) if not a <= i <= b]
    remap = {old: new for new, old in enumerate(keep)}
    geometry["faces"] = [geometry["faces"][i] for i in keep]
    geometry["object_face_ranges"] = {k: [remap[x], remap[y]] for k, (x, y) in geometry["object_face_ranges"].items()}
    geometry["face_materials"] = {remap[i]: m for i, m in geometry["face_materials"].items() if i in remap}
    _, preview, _ = _preview(tmp_path, geometry, _pairs(), "2")
    assert preview["leak_check"]["leak"]
    leak = next(p for p in preview["problems"] if p["code"] == "pffdtd_leak")
    assert leak["positions"] and max(p[2] for p in leak["positions"]) > 2.4  # leaves through the top


def test_listener_next_to_wall_flagged(tmp_path):
    near_wall = [3.97, 1.5, 1.2]  # < 1 cell from the x = 4 m wall
    pairs = [{"source_id": "s1", "source_position": SOURCE, "receiver_id": "rw", "receiver_position": near_wall},
             {"source_id": "s1", "source_position": SOURCE, "receiver_id": "rx", "receiver_position": RECEIVER_X}]
    result, preview, _ = _preview(tmp_path, _geometry(), pairs, "3")
    flagged = [p for p in preview["problems"] if p.get("seed") == {"kind": "receiver", "id": "rw"}]
    assert flagged and flagged[0]["severity"] == "error"
    assert flagged[0]["code"] in ("pffdtd_seed_clearance", "pffdtd_seed_on_boundary")
    assert not any(p.get("seed", {}).get("id") == "rx" for p in preview["problems"])
    assert result["n_errors"] >= 1


def test_voxelisation_cached_and_reused(tmp_path, monkeypatch):
    cache = tmp_path / "vox"
    monkeypatch.setattr(preview_job, "PFFDTD_VOXEL_CACHE_DIR", str(cache))
    _, first, first_bin = _preview(tmp_path, _geometry(), _pairs(), "4")
    # the voxelisation and the cut cells of the first source's air region (what a run starts from)
    entries = sorted(cache.glob("vox_*.npz"))
    assert len(entries) == 2 and sum("_cut_" in e.name for e in entries) == 1
    mtimes = [e.stat().st_mtime_ns for e in entries]

    _, second, second_bin = _preview(tmp_path, _geometry(), _pairs(), "5")
    assert sorted(cache.glob("vox_*.npz")) == entries  # same keys: reused, not new entries
    assert all(e.stat().st_mtime_ns >= m for e, m in zip(entries, mtimes))
    assert second["grid"] == {**first["grid"]} and second["materials"] == first["materials"]
    assert second_bin.read_bytes() == first_bin.read_bytes()
