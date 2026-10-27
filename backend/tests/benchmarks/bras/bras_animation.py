"""Wave-propagation animation data of one loudspeaker (omni pulse) on a horizontal plane.

The benchmark's directional runs are reciprocal (the field in the grid radiates from the
microphones), so the animation uses one extra *forward* omni run from the loudspeaker in the same
padded domain; it keeps its animation base, and the app's on-demand animation job
(``services.pffdtd_animation_job.run_pffdtd_animation``: one-cycle pulse at 1.5 / fmax, plane
snapshots) records the frames. An empty-domain control animation removes the domain-edge echoes.
Frames, plane axes, wall mask, scene positions and the highlighted pair's IRs are bundled in one
npz, so the animation can be rendered (``bras_render``) without the solver.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import asdict, replace
from pathlib import Path
from typing import Optional

import numpy as np

from benchmarks.bras import bras_constants as K
from benchmarks.bras.bras_runner import RunConfig, simulate
from benchmarks.bras.bras_scene import MeasuredPair, build_pairs_data
from benchmarks.bras.scenes import AnimationSpec
from config.constants import PFFDTD_FIELD_DIR, PFFDTD_SPEED_OF_SOUND, PFFDTD_TEMP_DIR, PFFDTD_VERSION
from services.pffdtd_animation_job import run_pffdtd_animation

BUNDLE_FORMAT = 3  # 3: scene label, object bbox, floor-aware edge removal
ANIMATION_RUNS_DIR = "animation_runs"


def animation_source(pairs: list[MeasuredPair], spec: AnimationSpec) -> Optional[str]:
    """The loudspeaker to animate (BRAS_ANIMATION, else the scene's), None if off."""
    wanted = os.environ.get(K.ENV_ANIMATION, spec.source if spec.enabled else "off").strip()
    if wanted.lower() in ("off", "0", "no", "false", ""):
        return None
    sources = [p.source_id for p in pairs]
    return wanted if wanted in sources else sources[0]


def plane_height(spec: AnimationSpec, source_position) -> float:
    return float(spec.plane_z if spec.plane_z is not None else np.asarray(source_position)[2])


def bundle_path(out_dir: Path, source_id: str, z: float) -> Path:
    return Path(out_dir) / K.ANIMATION_DIR / f"wave_{source_id}_z{z:.2f}.npz"


def _hash(cfg: RunConfig, bounds, z: float, ms: float, extra_keys: list) -> str:
    payload = [asdict(cfg), bounds, ms, z, PFFDTD_VERSION, BUNDLE_FORMAT, extra_keys]
    return hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _cleanup(simulation_id: str) -> None:
    for f in Path(PFFDTD_FIELD_DIR).glob(f"pffdtd_{simulation_id}_*"):
        f.unlink(missing_ok=True)
    shutil.rmtree(Path(PFFDTD_TEMP_DIR) / simulation_id, ignore_errors=True)


def _read_field(run_dir: Path, simulation_id: str) -> dict:
    results = json.loads((run_dir / f"pffdtd_{simulation_id}_results.json").read_text())
    field = results["field"]
    nx, ny = int(field["nx"]), int(field["ny"])
    anim = field["sources"][0]["animation"]
    frames = np.fromfile(Path(PFFDTD_FIELD_DIR) / anim["file"], np.int8).reshape(int(anim["frames"]), ny, nx)
    mask = np.fromfile(Path(PFFDTD_FIELD_DIR) / field["mask_file"], np.uint8).reshape(ny, nx)
    return {
        "frames": frames, "vmax": float(anim["vmax"]), "times_ms": np.asarray(anim["times_ms"], np.float64),
        "x": float(field["x0"]) + float(field["dx"]) * np.arange(nx),
        "y": float(field["y0"]) + float(field["dy"]) * np.arange(ny),
        "z": float(field["z"]), "mask": mask,
    }


def _animate(cfg: RunConfig, geometry: dict, pairs: list[MeasuredPair], bounds, z: float, ms: float,
             out_root: Path) -> tuple[dict, object]:
    """One forward omni run (keeps its animation base) + the app's animation job -> (field, run)."""
    run = simulate(cfg, geometry, build_pairs_data(pairs, {}), bounds, force=True, out_root=out_root, keep_work=True)
    try:
        progress, result_file = run.run_dir / "anim_progress.json", run.run_dir / "anim_result.json"
        print(f"[bras] wave animation {cfg.tag()} at z = {z:.2f} m ({ms:g} ms)...", flush=True)
        run_pffdtd_animation(run.simulation_id, str(progress), str(result_file), z, ms, str(run.run_dir))
        result = json.loads(result_file.read_text())
        if result.get("type") != "done":
            raise RuntimeError(f"Wave animation failed: {result.get('message')}\n{result.get('traceback', '')}")
        return _read_field(run.run_dir, run.simulation_id), run
    finally:
        _cleanup(run.simulation_id)


def dequantize(frames: np.ndarray, vmax: float) -> np.ndarray:
    return np.asarray(frames, np.float32) * np.float32(vmax / 127.0)


def quantize(field: np.ndarray, vmax: float) -> np.ndarray:
    return np.clip(np.round(field / vmax * 127.0), -127, 127).astype(np.int8)


def remove_edge_echoes(plate: np.ndarray, control: np.ndarray, x, y, z: float, times_s, source, bmin, bmax,
                       fmax: float, c: float = PFFDTD_SPEED_OF_SOUND, ground_z: Optional[float] = None) -> np.ndarray:
    """``plate - (control - control's physical waves)``, per pixel ([F, ny, nx] float fields).

    The control run (same grid and source, no objects) holds the direct wave, the floor reflection
    (``ground_z``) and the domain-edge echoes. Its physical waves are kept from each pixel's direct
    arrival until ANIMATION_DIRECT_KEEP_PERIODS pulse periods after its last physical arrival, or
    half way to that pixel's first edge echo if sooner (a half-Hann fade of one period ends the
    window); everything later is the edge echo and is subtracted. The face under a floor is
    shielded by it. Near the domain faces the echo follows too closely to separate; the objects'
    own scattered waves reflected by the edges (much weaker) stay.
    """
    X, Y = np.meshgrid(np.asarray(x, np.float64), np.asarray(y, np.float64))
    P = np.stack([X, Y, np.full_like(X, z)], axis=-1)
    s = np.asarray(source, np.float64)
    r = np.linalg.norm(P - s, axis=-1)
    echo = np.full(r.shape, np.inf)
    for k in range(3):
        for side, plane in (("min", bmin[k]), ("max", bmax[k])):
            if ground_z is not None and k == 2 and side == "min":
                continue
            img = s.copy()
            img[k] = 2.0 * plane - s[k]
            echo = np.minimum(echo, np.linalg.norm(P - img, axis=-1) - r)
    extra = np.zeros_like(r)
    if ground_z is not None:
        img = s.copy()
        img[2] = 2.0 * ground_z - s[2]
        extra = np.linalg.norm(P - img, axis=-1) - r
    period = K.ANIMATION_PULSE_PERIODS_PER_FMAX / fmax
    keep = np.minimum(extra / c + K.ANIMATION_DIRECT_KEEP_PERIODS * period, 0.5 * (extra + echo) / c)
    fade = np.maximum(np.minimum(period, 0.5 * keep), 1e-9)
    end = r / c + keep
    t = np.asarray(times_s, np.float64)[:, None, None]
    u = np.clip((end - t) / fade, 0.0, 1.0)                  # 1 before the fade, 0 after the window
    w = (0.5 - 0.5 * np.cos(np.pi * u)).astype(np.float32)
    return plate - control * (1.0 - w)


def export_animation(cfg: RunConfig, scene_geometry: dict, control_geometry: dict, pairs: list[MeasuredPair],
                     spec: AnimationSpec, bounds, out_dir: Path, scene_label: str, obj_bbox: tuple,
                     ground_z: Optional[float] = None, pair_irs: Optional[dict] = None, force: bool = False,
                     sim_source_phase: bool = False,
                     remove_edges: bool = K.ANIMATION_REMOVE_EDGE_ECHOES) -> Optional[dict]:
    """Bundle the wave animation of one loudspeaker next to the benchmark run; returns its meta.

    ``pair_irs`` (``{"measured" | "simulated": (fs, ir)}``) are the highlighted pair's IRs for the
    side panels (``sim_source_phase``: the simulated one carries the loudspeaker phase).
    ``remove_edges`` runs an empty-domain control animation and subtracts its domain-edge echoes
    (``frames``); ``frames_raw`` keeps the uncorrected field.
    """
    sid = animation_source(pairs, spec)
    if sid is None:
        return None
    anim_pairs = [p for p in pairs if p.source_id == sid]
    highlight = next((p for p in anim_pairs if p.receiver_id == spec.receiver), anim_pairs[0])
    z = plane_height(spec, highlight.source_position)
    anim_cfg = replace(cfg, pair_keys=[p.key for p in anim_pairs], directional=False, control=False,
                       extra={"animation_ms": spec.duration_ms, "plane_z": z})
    path = bundle_path(out_dir, sid, z)
    meta_path = path.with_suffix(".json")
    digest = _hash(anim_cfg, bounds, z, spec.duration_ms,
                   sorted(pair_irs or {}) + [f"phase={sim_source_phase}", f"edges={remove_edges}", f"ground={ground_z}"])
    if path.exists() and meta_path.exists() and not force:
        meta = json.loads(meta_path.read_text())
        if meta.get("hash") == digest:
            return meta

    runs_root = Path(out_dir) / ANIMATION_RUNS_DIR
    field, run = _animate(anim_cfg, scene_geometry, anim_pairs, bounds, z, spec.duration_ms, runs_root)
    frames_raw = field.pop("frames")
    frames = frames_raw
    if remove_edges:
        ctl, _ = _animate(replace(anim_cfg, control=True), control_geometry, anim_pairs, bounds, z, spec.duration_ms, runs_root)
        if ctl["frames"].shape != frames_raw.shape or not np.allclose(ctl["times_ms"], field["times_ms"]):
            raise RuntimeError("Control animation does not match the scene animation (grid, plane or frames)")
        cleaned = remove_edge_echoes(dequantize(frames_raw, field["vmax"]), dequantize(ctl["frames"], ctl["vmax"]),
                                     field["x"], field["y"], field["z"], field["times_ms"] * 1e-3,
                                     highlight.source_position, bounds[0], bounds[1], cfg.fmax, ground_z=ground_z)
        frames = quantize(cleaned, field["vmax"])

    irs = {f"ir_{name}": np.asarray(ir, np.float32) for name, (_, ir) in (pair_irs or {}).items()}
    irs_fs = {f"fs_{name}": np.float64(fs) for name, (fs, _) in (pair_irs or {}).items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path, **field, **irs, **irs_fs, frames=frames, frames_raw=frames_raw,
        edge_echoes_removed=bool(remove_edges), sim_source_phase=bool(sim_source_phase), scene_label=scene_label,
        ir_omni_forward=np.asarray(run.irs[highlight.key], np.float32), fs_omni_forward=np.float64(run.fs),
        source_id=sid, source_position=highlight.source_position,
        receiver_ids=np.array([p.receiver_id for p in anim_pairs]),
        receiver_positions=np.vstack([p.receiver_position for p in anim_pairs]),
        highlight_receiver=highlight.receiver_id, object_bmin=np.asarray(obj_bbox[0]), object_bmax=np.asarray(obj_bbox[1]),
        domain_bmin=np.asarray(bounds[0]), domain_bmax=np.asarray(bounds[1]), fmax=np.float64(cfg.fmax),
        h=np.float64(run.results["grid"]["h"]),
    )
    meta = {
        "hash": digest, "format": BUNDLE_FORMAT, "file": path.name, "source_id": sid,
        "highlight_receiver": highlight.receiver_id, "plane_z": field["z"], "frames": int(frames.shape[0]),
        "nx": int(field["x"].size), "ny": int(field["y"].size), "dx": float(field["x"][1] - field["x"][0]),
        "times_ms": [float(field["times_ms"][0]), float(field["times_ms"][-1])], "fmax": cfg.fmax,
        "pulse": "one sine cycle, period 1.5 / fmax, omni monopole at the loudspeaker",
        "edge_echoes_removed": bool(remove_edges), "sim_source_phase": bool(sim_source_phase),
        "arrays": {
            "frames": "int8 [F, ny, nx]; pressure = frames / 127 * vmax (arbitrary units); domain-edge "
                      "echoes removed when edge_echoes_removed (frames_raw: uncorrected, same scale)",
            "x, y": "plane node coordinates (m); frames[f, j, i] is at (x[i], y[j], z)",
            "mask": "uint8 [ny, nx]: 0 air, 1 wall, 2 outside",
            "ir_*": "IRs of the highlighted pair (fs_* = sample rate); ir_simulated carries the loudspeaker "
                    "phase when sim_source_phase; ir_omni_forward = this run (re 1 m)",
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta


def load_bundle(path: Path | str) -> dict:
    with np.load(path, allow_pickle=False) as data:
        return {k: data[k] for k in data.files}
