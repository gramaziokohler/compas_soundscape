"""Runs the app's pyroomacoustics worker on the benchmark scene (image sources, geometrical acoustics).

``services.pyroomacoustics_worker._run_pyroomacoustics_compute_loop`` is the compute path of both
the Speckle and the direct-geometry jobs: simulation-mesh preparation, one room per emitter, the
measured loudspeaker balloon, WAVs re free field at 1 m. It takes the same geometry dict and pair
list as the PFFDTD job, so both engines simulate the same scene. It runs on the CPU, so the
benchmark starts it in a thread while the GPU runs PFFDTD. Results are cached like the PFFDTD runs.

Geometrical acoustics has no diffraction: behind an obstacle the IR may be empty, and such a
pair is reported as "no sound path".
"""
from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from benchmarks.bras.bras_constants import AIR_ABSORPTION, PRA_INT16_SCALE, SIMULATION_MODE
from config.constants import PFFDTD_SPEED_OF_SOUND, PYROOMACOUSTICS_RAY_TRACING_N_RAYS

MANIFEST = "manifest.json"
NO_PATH = "No sound path"


@dataclass
class PraConfig:
    scene: str
    max_order: int
    ray_tracing: bool
    pair_keys: list
    directional: bool = True
    material_mode: str = "csv"

    def tag(self) -> str:
        pairs = hashlib.sha1("+".join(self.pair_keys).encode()).hexdigest()[:6]
        mode = "ism+rt" if self.ray_tracing else "ism"
        return f"{self.scene}_pra_{mode}{self.max_order}_{'dir' if self.directional else 'omni'}_p{len(self.pair_keys)}_{pairs}"


@dataclass
class PraRun:
    run_dir: Path
    irs: dict                 # "LS1-MP1" -> float64 IR at ``fs`` (re free field at 1 m), fractional-delay lead removed
    fs: int
    cached: bool
    wall_s: float
    no_path: list = field(default_factory=list)   # pairs the engine found no sound path for
    error: str = ""


def frac_delay_lead() -> int:
    """Samples every pyroomacoustics RIR is late by (half its fractional-delay filter)."""
    import pyroomacoustics as pra

    return int(pra.constants.get("frac_delay_length")) // 2


def _hash(cfg: PraConfig, geometry: dict, pairs_data: list) -> str:
    payload = json.dumps([asdict(cfg), geometry, pairs_data], sort_keys=True, default=str)
    return hashlib.sha1(payload.encode()).hexdigest()


def _load(run_dir: Path, manifest: dict) -> dict:
    lead, irs = int(manifest["lead"]), {}
    for key, name in manifest["wavs"].items():
        _, x = wavfile.read(str(run_dir / "rir" / name))
        irs[key] = np.asarray(x, np.float64)[lead:] / PRA_INT16_SCALE
    return irs


def _simulate_pairs(sim_id: str, cfg: PraConfig, geometry: dict, pairs_data: list, run_dir: Path) -> dict:
    """One call of the app's compute loop; returns its result payload."""
    from services.pyroomacoustics_worker import _run_pyroomacoustics_compute_loop

    result_file = run_dir / f"result_{sim_id}.json"
    result_file.unlink(missing_ok=True)
    try:
        _run_compute_loop(_run_pyroomacoustics_compute_loop, sim_id, cfg, geometry, pairs_data, run_dir, result_file)
    except Exception as exc:  # e.g. a pair with no sound path: the loop raises, the jobs' wrappers report it
        return {"type": "error", "message": str(exc)}
    return json.loads(result_file.read_text())


def _run_compute_loop(loop, sim_id: str, cfg: PraConfig, geometry: dict, pairs_data: list, run_dir: Path, result_file: Path) -> None:
    loop(
        simulation_id=sim_id, progress_file=str(run_dir / "progress.json"), result_file=str(result_file),
        simulation_name=f"BRAS {cfg.tag()}", pairs_data=pairs_data, vertices=geometry["vertices"],
        faces=geometry["faces"], object_face_ranges=geometry["object_face_ranges"],
        face_material_map={int(k): v for k, v in geometry["face_materials"].items()}, face_scattering_map=None,
        mesh_settings=None, simulation_mode=SIMULATION_MODE, max_order=cfg.max_order, ray_tracing=cfg.ray_tracing,
        air_absorption=AIR_ABSORPTION, n_rays=PYROOMACOUSTICS_RAY_TRACING_N_RAYS, sound_speed=PFFDTD_SPEED_OF_SOUND,
        rir_dir=run_dir / "rir", tmp_dir=run_dir, entry_meta={}, parallel=True,
    )


def simulate_pra(cfg: PraConfig, geometry: dict, pairs_data: list, out_root: Path, force: bool = False) -> PraRun:
    """The scene's pairs with pyroomacoustics. Never raises: a failure is returned in ``error``
    so the PFFDTD benchmark it accompanies still completes."""
    run_dir = Path(out_root) / cfg.tag()
    digest = _hash(cfg, geometry, pairs_data)
    manifest_path = run_dir / MANIFEST
    if manifest_path.exists() and not force:
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("hash") == digest and all((run_dir / "rir" / n).exists() for n in manifest["wavs"].values()):
            return PraRun(run_dir, _load(run_dir, manifest), manifest["fs"], True, manifest["wall_s"], manifest["no_path"])
    shutil.rmtree(run_dir, ignore_errors=True)
    (run_dir / "rir").mkdir(parents=True)
    t0 = time.time()
    wavs, no_path, fs = {}, [], 0
    try:
        from config.constants import PYROOMACOUSTICS_SAMPLE_RATE

        fs = int(PYROOMACOUSTICS_SAMPLE_RATE)
        # one loudspeaker per call: a pair without any sound path fails its whole call, and the
        # shadowed pairs of a loudspeaker must not take its other pairs with them
        by_source: dict[str, list] = {}
        for p in pairs_data:
            by_source.setdefault(p["source_id"], []).append(p)
        for sid, group in by_source.items():
            pending = list(group)
            while pending:
                result = _simulate_pairs(f"{cfg.tag()}_{sid}", cfg, geometry, pending, run_dir)
                if result.get("type") == "done":
                    for p in pending:
                        wavs[f"{p['source_id']}-{p['receiver_id']}"] = f"sim_{cfg.tag()}_{sid}_src_{p['source_id']}_rcv_{p['receiver_id']}.wav"
                    break
                message = str(result.get("message", ""))
                blocked = next((p for p in pending if NO_PATH in message and f"'{p['source_id']}'" in message
                                and f"'{p['receiver_id']}'" in message), None)
                if blocked is None:
                    raise RuntimeError(message or "pyroomacoustics run failed")
                no_path.append(f"{blocked['source_id']}-{blocked['receiver_id']}")
                pending.remove(blocked)
    except Exception as exc:  # the comparison goes on without this engine
        return PraRun(run_dir, {}, fs, False, time.time() - t0, no_path, f"{type(exc).__name__}: {exc}")
    manifest = {"hash": digest, "tag": cfg.tag(), "config": asdict(cfg), "wavs": wavs, "fs": fs, "lead": frac_delay_lead(),
                "wall_s": time.time() - t0, "no_path": no_path}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return PraRun(run_dir, _load(run_dir, manifest), fs, False, manifest["wall_s"], no_path)
