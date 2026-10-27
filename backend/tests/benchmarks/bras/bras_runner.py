"""Runs the real PFFDTD worker entry point on the BRAS scene and caches the WAVs per run tag.

``run_pffdtd_simulation_from_geometry`` does exactly what a Speckle job does after the fetch:
mesh preparation, preflight, grid plan, scene export, the compas-pffdtd pipeline and WAVs
(48 kHz float32, re free field at 1 m). A run whose manifest hash matches is not re-simulated.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from benchmarks.bras.bras_constants import AIR_ABSORPTION, OUTPUT_ROOT, SIMULATION_MODE
from config.constants import PFFDTD_TEMP_DIR, PFFDTD_VERSION
from services.pffdtd_job import run_pffdtd_simulation_from_geometry

MANIFEST = "manifest.json"
PROGRESS_POLL_S = 5.0


@dataclass
class RunConfig:
    scene: str
    fmax: float
    ppw: float
    grid_spacing: float              # planned by bras_domain; passed to the job
    duration: float
    pair_keys: list
    directional: bool = True
    material_mode: str = "csv"
    control: bool = False
    padding_m: float = 3.0
    extra: dict = field(default_factory=dict)

    def tag(self) -> str:
        pairs = "+".join(k.replace("-", "") for k in self.pair_keys)
        if len(self.pair_keys) > 3:
            pairs = f"p{len(self.pair_keys)}_" + hashlib.sha1(pairs.encode()).hexdigest()[:6]
        src = "dir" if self.directional else "omni"
        mat = "ctl" if self.control else self.material_mode
        return f"{self.scene}_f{self.fmax:g}_ppw{self.ppw:g}_{src}_{pairs}_{mat}"


@dataclass
class SimRun:
    run_dir: Path
    irs: dict            # "LS1-MP1" -> float64 IR at 48 kHz (re free field at 1 m)
    fs: int
    results: dict        # the worker's results JSON
    cached: bool
    wall_s: float
    simulation_id: str = ""


def simulation_id(cfg: RunConfig) -> str:
    return f"bras_rs2_{cfg.tag()}"


def _hash(cfg: RunConfig, geometry: dict, pairs_data: list, domain_bounds) -> str:
    payload = json.dumps([asdict(cfg), geometry, pairs_data, domain_bounds, PFFDTD_VERSION], sort_keys=True, default=str)
    return hashlib.sha1(payload.encode()).hexdigest()


def _tail_progress(progress_file: Path, stop: threading.Event, label: str) -> None:
    last = None
    while not stop.wait(PROGRESS_POLL_S):
        try:
            p = json.loads(progress_file.read_text())
        except (OSError, ValueError):
            continue
        line = f"{p.get('value', 0):>3}% {p.get('status', '')}"
        if line != last:
            print(f"[bras {label}] {line}", flush=True)
            last = line


def _load(run_dir: Path, manifest: dict) -> dict:
    irs = {}
    for key, name in manifest["wavs"].items():
        fs, x = wavfile.read(str(run_dir / "rir" / name))
        irs[key] = np.asarray(x, np.float64)
    return irs


def simulate(cfg: RunConfig, geometry: dict, pairs_data: list, domain_bounds, force: bool = False,
             out_root: Path = OUTPUT_ROOT, keep_work: bool = False) -> SimRun:
    """``keep_work`` keeps PFFDTD_TEMP_DIR/<simulation_id> (the animation base of a forward run)."""
    run_dir = Path(out_root) / cfg.tag()
    sim_id = simulation_id(cfg)
    digest = _hash(cfg, geometry, pairs_data, domain_bounds)
    manifest_path = run_dir / MANIFEST
    if manifest_path.exists() and not force:
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("hash") == digest and all((run_dir / "rir" / n).exists() for n in manifest["wavs"].values()):
            return SimRun(run_dir, _load(run_dir, manifest), manifest["fs"], manifest["results"], True,
                          manifest["wall_s"], sim_id)

    if run_dir.exists():
        shutil.rmtree(run_dir)
    (run_dir / "rir").mkdir(parents=True)
    progress, result_file = run_dir / "progress.json", run_dir / "result.json"
    stop = threading.Event()
    watcher = threading.Thread(target=_tail_progress, args=(progress, stop, cfg.tag()), daemon=True)
    watcher.start()
    t0 = time.time()
    try:
        run_pffdtd_simulation_from_geometry(
            simulation_id=sim_id, progress_file=str(progress), result_file=str(result_file),
            geometry=geometry, pairs_data=pairs_data, simulation_mode=SIMULATION_MODE,
            fmax=cfg.fmax, ppw=cfg.ppw, duration=cfg.duration, air_absorption=AIR_ABSORPTION,
            simulation_name=f"BRAS {cfg.tag()}", rir_output_dir=str(run_dir / "rir"), temp_dir=str(run_dir),
            domain_bounds=domain_bounds, grid_spacing=cfg.grid_spacing,
        )
    finally:
        stop.set()
    wall = time.time() - t0
    result = json.loads(result_file.read_text())
    if result.get("type") != "done":
        raise RuntimeError(f"PFFDTD run {sim_id} failed: {result.get('message')}\n{result.get('traceback', '')}")
    results = json.loads((run_dir / result["result"]["results_file"]).read_text())
    if not keep_work:  # the work folder keeps a GB-sized animation base
        shutil.rmtree(Path(PFFDTD_TEMP_DIR) / sim_id, ignore_errors=True)
    wavs = {f"{e['source_id']}-{e['receiver_id']}": e["ir_file"] for e in results["results"]}
    fs = int(results["results"][0]["sample_rate"])
    manifest = {"hash": digest, "tag": cfg.tag(), "config": asdict(cfg), "domain_bounds": domain_bounds,
                "wavs": wavs, "fs": fs, "wall_s": wall, "results": results,
                "created": time.strftime("%Y-%m-%d %H:%M:%S"), "pffdtd_version": PFFDTD_VERSION,
                "host": os.environ.get("COMPUTERNAME", "")}
    manifest_path.write_text(json.dumps(manifest, indent=2, default=str))
    return SimRun(run_dir, _load(run_dir, manifest), fs, results, False, wall, sim_id)
