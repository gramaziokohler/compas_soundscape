"""Runs the app's geometric-acoustics worker on the benchmark scene (image sources, geometrical acoustics).

The engine is the app's default (``ACOUSTICS_ENGINE``: compas_acoustics, or the legacy
pyroomacoustics path); ``BRAS_GA_ENGINE`` overrides it for the benchmark and
``BRAS_GA_DIFFRACTION`` (off | udfa) turns on compas_acoustics' edge diffraction.

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
import os
import shutil
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
from scipy.io import wavfile

from benchmarks.bras.bras_constants import AIR_ABSORPTION, PRA_INT16_SCALE, PRA_MESH_SETTINGS, SIMULATION_MODE
from config.constants import (ACOUSTICS_ENGINE_COMPAS_ACOUSTICS, ACOUSTICS_ENGINE_DEFAULT, ACOUSTICS_ENGINE_PYROOMACOUSTICS,
                              CA_DIFFRACTION_OFF, PFFDTD_SPEED_OF_SOUND, PYROOMACOUSTICS_RAY_TRACING_N_RAYS)

MANIFEST = "manifest.json"
NO_PATH = "No sound path"
ENGINE = os.environ.get("BRAS_GA_ENGINE", ACOUSTICS_ENGINE_DEFAULT).strip().lower()
DIFFRACTION = os.environ.get("BRAS_GA_DIFFRACTION", CA_DIFFRACTION_OFF).strip().lower()
ENGINE_LABELS = {ACOUSTICS_ENGINE_COMPAS_ACOUSTICS: "compas_acoustics", ACOUSTICS_ENGINE_PYROOMACOUSTICS: "pyroomacoustics"}
ENGINE_LABEL = ENGINE_LABELS.get(ENGINE, ENGINE)   # the second engine's name in plots and reports


@dataclass
class PraConfig:
    scene: str
    max_order: int
    ray_tracing: bool
    pair_keys: list
    directional: bool = True
    material_mode: str = "csv"
    engine: str = ENGINE
    # compas_acoustics only: the chamber's air (speed of sound, ISO 9613-1 absorption) and edge diffraction
    temperature_c: Optional[float] = None
    humidity: Optional[float] = None
    diffraction: str = DIFFRACTION

    def __post_init__(self):
        if self.engine not in ENGINE_LABELS:
            raise ValueError(f"Unknown geometric-acoustics engine {self.engine!r}; one of {sorted(ENGINE_LABELS)}")
        if self.engine == ACOUSTICS_ENGINE_PYROOMACOUSTICS:   # the legacy engine has neither: keep its cache keys
            self.temperature_c = self.humidity = None
            self.diffraction = CA_DIFFRACTION_OFF

    def tag(self) -> str:
        pairs = hashlib.sha1("+".join(self.pair_keys).encode()).hexdigest()[:6]
        mode = "ism+rt" if self.ray_tracing else "ism"
        engine = "pra" if self.engine == ACOUSTICS_ENGINE_PYROOMACOUSTICS else "ca"
        if self.diffraction != CA_DIFFRACTION_OFF:
            mode += f"+{self.diffraction}"
        return f"{self.scene}_{engine}_{mode}{self.max_order}_{'dir' if self.directional else 'omni'}_p{len(self.pair_keys)}_{pairs}"


@dataclass
class PraRun:
    run_dir: Path
    irs: dict                 # "LS1-MP1" -> float64 IR at ``fs`` (re free field at 1 m), fractional-delay lead removed
    fs: int
    cached: bool
    wall_s: float
    no_path: list = field(default_factory=list)   # pairs the engine found no sound path for
    error: str = ""
    config: dict = field(default_factory=dict)    # the PraConfig the run used


def frac_delay_lead(engine: str = ENGINE) -> int:
    """Samples every pyroomacoustics RIR is late by (half its fractional-delay filter);
    compas_acoustics already removes it."""
    if engine != ACOUSTICS_ENGINE_PYROOMACOUSTICS:
        return 0
    import pyroomacoustics as pra

    return int(pra.constants.get("frac_delay_length")) // 2


def _hash(cfg: PraConfig, geometry: dict, pairs_data: list) -> str:
    config = asdict(cfg)
    if cfg.engine == ACOUSTICS_ENGINE_PYROOMACOUSTICS:   # same hash as before the engine became a setting
        for k in ("engine", "temperature_c", "humidity", "diffraction"):
            config.pop(k)
    payload = json.dumps([config, geometry, pairs_data, PRA_MESH_SETTINGS], sort_keys=True, default=str)
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
        mesh_settings=dict(PRA_MESH_SETTINGS), simulation_mode=SIMULATION_MODE, max_order=cfg.max_order, ray_tracing=cfg.ray_tracing,
        air_absorption=AIR_ABSORPTION, n_rays=PYROOMACOUSTICS_RAY_TRACING_N_RAYS, sound_speed=PFFDTD_SPEED_OF_SOUND,
        rir_dir=run_dir / "rir", tmp_dir=run_dir, entry_meta={}, parallel=True,
        engine=cfg.engine, diffraction=cfg.diffraction, air_temperature=cfg.temperature_c,
        **({"air_humidity": cfg.humidity} if cfg.humidity is not None else {}),
    )


def _silent(irs: dict, no_path: list) -> tuple[dict, list]:
    """Pairs whose IR is all zeros have no sound path (compas_acoustics returns silence instead of failing)."""
    silent = [k for k, x in irs.items() if not np.any(x)]
    return {k: x for k, x in irs.items() if k not in silent}, list(no_path) + [k for k in silent if k not in no_path]


def simulate_pra(cfg: PraConfig, geometry: dict, pairs_data: list, out_root: Path, force: bool = False) -> PraRun:
    """The scene's pairs with pyroomacoustics. Never raises: a failure is returned in ``error``
    so the PFFDTD benchmark it accompanies still completes."""
    run_dir = Path(out_root) / cfg.tag()
    digest = _hash(cfg, geometry, pairs_data)
    manifest_path = run_dir / MANIFEST
    if manifest_path.exists() and not force:
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("hash") == digest and all((run_dir / "rir" / n).exists() for n in manifest["wavs"].values()):
            irs, no_path = _silent(_load(run_dir, manifest), manifest["no_path"])
            return PraRun(run_dir, irs, manifest["fs"], True, manifest["wall_s"], no_path, config=asdict(cfg))
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
        return PraRun(run_dir, {}, fs, False, time.time() - t0, no_path, f"{type(exc).__name__}: {exc}", asdict(cfg))
    manifest = {"hash": digest, "tag": cfg.tag(), "config": asdict(cfg), "wavs": wavs, "fs": fs, "lead": frac_delay_lead(cfg.engine),
                "wall_s": time.time() - t0, "no_path": no_path}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    irs, no_path = _silent(_load(run_dir, manifest), no_path)
    return PraRun(run_dir, irs, fs, False, manifest["wall_s"], no_path, config=asdict(cfg))
