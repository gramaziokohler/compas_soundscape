"""Run the compiled PFFDTD CUDA engine on a prepared GPU data directory."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from pffdtd_backend import PFFDTD_ENGINE_DIR

PROGRESS_PREFIX = "PFFDTD_PROGRESS"
ENGINE_LOG = "engine.log"

# progress callback: (percent 0..100, elapsed_s, eta_s)
ProgressCallback = Callable[[float, float, float], None]


class EngineError(RuntimeError):
    pass


_active: set[subprocess.Popen] = set()
_active_lock = threading.Lock()


def kill_active() -> None:
    """Kill every running engine exe (called when the job is cancelled / the parent dies).

    The exe is a separate process: killing the Python pipeline does not stop it on Windows,
    and it may print its next progress line only after a long time on a large grid.
    """
    with _active_lock:
        for proc in list(_active):
            try:
                proc.kill()
            except OSError:
                pass


def engine_exe(precision: str) -> Path:
    assert precision in ("single", "double")
    exe = PFFDTD_ENGINE_DIR / f"fdtd_main_gpu_{precision}.exe"
    if not exe.exists():
        raise EngineError(f"{exe} missing; build it with c_cuda/build_engine.ps1")
    return exe


def engine_env() -> dict:
    """Subprocess env with this interpreter's Library/bin first (hdf5.dll and its deps)."""
    env = dict(os.environ)
    lib_bin = Path(sys.prefix) / "Library" / "bin"
    env["PATH"] = f"{lib_bin}{os.pathsep}{env.get('PATH', '')}"
    return env


def run_engine(
    gpu_dir: Path,
    precision: str = "double",
    on_progress: Optional[ProgressCallback] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> float:
    """Run the engine in ``gpu_dir`` (writes sim_outs.h5 there). Returns wall time in seconds."""
    gpu_dir = Path(gpu_dir)
    t0 = time.perf_counter()
    log_path = gpu_dir / ENGINE_LOG
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(
            [str(engine_exe(precision))],
            cwd=gpu_dir,
            env=engine_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        with _active_lock:
            _active.add(proc)
        try:
            rc = _pump(proc, log, on_progress, should_stop)
        finally:
            with _active_lock:
                _active.discard(proc)
    if rc != 0:
        tail = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-30:]
        raise EngineError(f"engine exited with {rc}:\n" + "\n".join(tail))
    return time.perf_counter() - t0


def _pump(proc, log, on_progress, should_stop) -> int:
    """Forward progress lines, log the rest; returns the exit code (EngineError on stop)."""
    for line in proc.stdout:
        if line.startswith(PROGRESS_PREFIX):
            parts = line.split()
            if on_progress is not None:
                on_progress(float(parts[1]), float(parts[2]), float(parts[3]))
        else:
            log.write(line)
        if should_stop is not None and should_stop():
            proc.kill()
            proc.wait()
            raise EngineError("cancelled")
    return proc.wait()
