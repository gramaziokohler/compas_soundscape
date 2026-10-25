"""PFFDTD job pipeline -- runs inside the compas-pffdtd env.

    <compas-pffdtd python> -I backend/pffdtd_backend/pipeline.py job.json --parent-pid <pid>

Called by services/pffdtd_job.py (compas-toy). For each source: fit materials (cached),
prepare + voxelise, run the CUDA engine, post-process the receivers to IRs at out_fs and
write <work_dir>/src_<i>.npz (irs [R, C, N]). Writes <work_dir>/meta.json at the end.

stdout protocol (one line each, flushed):
    COMPAS_PROGRESS <0-100> <message>
    COMPAS_ERROR <message>            (then exit code 2)
If the parent process disappears (job cancelled / worker killed), the engine is killed
and this process exits.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import numpy as np  # noqa: E402
import psutil  # noqa: E402

from pffdtd_backend.engine import EngineError, run_engine  # noqa: E402
from pffdtd_backend.materials import material_def_file  # noqa: E402
from pffdtd_backend.outputs import read_receivers  # noqa: E402
from pffdtd_backend.postprocess import foa_channels, probe_positions, to_ir  # noqa: E402
from pffdtd_backend.sim_prepare import SimSpec, prepare  # noqa: E402

PARENT_POLL_S = 1.0
# share of each source's progress span: setup/voxelisation, engine, post-processing
STAGE_SPLIT = (0.25, 0.65, 0.10)


def emit(pct: float, msg: str) -> None:
    print(f"COMPAS_PROGRESS {pct:.1f} {msg}", flush=True)


class ParentWatch:
    """Flags (and hard-exits) once the parent process is gone."""

    def __init__(self, parent_pid: int | None):
        self.parent_pid = parent_pid
        self.dead = False
        if parent_pid:
            threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            time.sleep(PARENT_POLL_S)
            if not psutil.pid_exists(self.parent_pid):
                self.dead = True
                time.sleep(3 * PARENT_POLL_S)  # give run_engine the chance to kill the exe
                os._exit(3)


def _quiet(fn, *args, **kwargs):
    """Upstream setup code prints a lot; keep it out of the progress protocol (to stderr)."""
    with contextlib.redirect_stdout(sys.stderr):
        return fn(*args, **kwargs)


def run_job(job: dict, watch: ParentWatch) -> dict:
    work_dir = Path(job["work_dir"])
    work_dir.mkdir(parents=True, exist_ok=True)
    foa = bool(job["foa"])
    h = float(job["h"])
    offset_m = float(job["foa_offset_cells"]) * h
    n_src = len(job["sources"])

    emit(1, "Fitting boundary materials...")
    mat_files = {
        name: str(_quiet(material_def_file, m["coeffs"], m["center_freqs"], job["material_cache_dir"]))
        for name, m in job["materials"].items()
    }

    receivers = np.asarray(job["receivers"], np.float64)
    probes = np.vstack([probe_positions(r, foa, offset_m) for r in receivers])
    n_probe = probes.shape[0] // receivers.shape[0]
    meta = {"h": h, "sources": []}

    for si, src in enumerate(job["sources"]):
        base = 100.0 * si / n_src
        span = 100.0 / n_src
        emit(base + 1, f"Source {si + 1}/{n_src}: voxelising the geometry...")
        spec = SimSpec(
            sim_dir=work_dir / f"src_{si}",
            scene={"mats_hash": job["mats_hash"], "sources": [{"xyz": src}], "receivers": [{"xyz": p} for p in probes.tolist()]},
            duration=float(job["duration"]),
            h=h,
            fcc=False,
            precision=job["precision"],
            mat_files=mat_files,
            Tc=float(job["Tc"]),
            rh=float(job["rh"]),
        )
        try:
            prep = _quiet(prepare, spec)
        except AssertionError as exc:
            raise RuntimeError(
                "Voxelisation check failed (a source or receiver may be within one grid cell of a "
                f"surface, or outside the model): {exc or 'assertion'}"
            ) from exc

        e0 = base + span * STAGE_SPLIT[0]

        def on_progress(pct, elapsed, eta, e0=e0, si=si):
            emit(e0 + span * STAGE_SPLIT[1] * pct / 100.0, f"Source {si + 1}/{n_src}: GPU solve {pct:.0f}% (ETA {eta:.0f} s)")

        runtime = run_engine(prep.gpu_dir, job["precision"], on_progress=on_progress, should_stop=lambda: watch.dead)

        emit(base + span * (STAGE_SPLIT[0] + STAGE_SPLIT[1]), f"Source {si + 1}/{n_src}: post-processing...")
        r_out, Ts = read_receivers(prep.gpu_dir)
        irs = []
        for ri in range(receivers.shape[0]):
            sig = r_out[ri * n_probe : (ri + 1) * n_probe]
            if foa:
                sig = foa_channels(sig, Ts, offset_m, prep.c)
            irs.append(
                _quiet(
                    to_ir,
                    sig,
                    Ts,
                    fmax=float(job["fmax"]),
                    out_fs=float(job["out_fs"]),
                    duration=float(job["duration"]),
                    lowcut_hz=float(job["lowcut_hz"]),
                    lowcut_order=int(job["lowcut_order"]),
                    lowpass_order=int(job["lowpass_order"]),
                    air_absorption=bool(job["air_absorption"]),
                    Tc=float(job["Tc"]),
                    rh=float(job["rh"]),
                )
            )
        np.savez(work_dir / f"src_{si}.npz", irs=np.asarray(irs, np.float32), fs=float(job["out_fs"]))
        meta["sources"].append(
            {"index": si, "Ts": prep.Ts, "c": prep.c, "grid": list(prep.shape), "boundary_nodes": prep.Nb, "steps": prep.Nt, "gpu_runtime_s": runtime}
        )
    emit(100, "Done")
    (work_dir / "meta.json").write_text(json.dumps(meta))
    return meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("job_json")
    ap.add_argument("--parent-pid", type=int, default=None)
    args = ap.parse_args()
    # progress lines must not be mangled by a legacy console code page
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    watch = ParentWatch(args.parent_pid)
    try:
        run_job(json.loads(Path(args.job_json).read_text()), watch)
    except EngineError as exc:
        print(f"COMPAS_ERROR {str(exc).splitlines()[0] if str(exc) else 'engine failed'}", flush=True)
        traceback.print_exc()
        return 2
    except Exception as exc:
        print(f"COMPAS_ERROR {type(exc).__name__}: {exc}", flush=True)
        traceback.print_exc()
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
