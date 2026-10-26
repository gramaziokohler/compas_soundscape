"""
Resident PFFDTD IR server, owned by the API process.

pffdtd_backend/ir_server.py runs in the isolated compas-pffdtd env (PFFDTD_PYTHON); this
module starts it on first use, talks to it over stdin/stdout (one JSON line each way), restarts
it after a crash or timeout and stops it after PFFDTD_IR_SERVER_IDLE_S without requests. The
server process watches the API's PID and exits with it (uvicorn --reload included).

Calls are blocking: run them off the event loop (services/io_jobs.run_blocking). One request
is served at a time; ``is_current`` lets a caller drop a request that a newer move superseded
while it waited for its turn.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from config.constants import (
    PFFDTD_FREE_DIR,
    PFFDTD_IR_SERVER_IDLE_S,
    PFFDTD_IR_SERVER_REQUEST_TIMEOUT_S,
    PFFDTD_IR_SERVER_SCRIPT,
    PFFDTD_IR_SERVER_START_TIMEOUT_S,
    PFFDTD_PYTHON,
)

READY = "COMPAS_IR_READY"
PREFIX = "COMPAS_IR "
IDLE_CHECK_S = 30.0


class IrServerError(RuntimeError):
    pass


class Superseded(Exception):
    """A newer request for the same object arrived before this one was served."""


def _server_env() -> dict:
    """compas-pffdtd's DLL folders first (same as the simulation pipeline)."""
    prefix = Path(PFFDTD_PYTHON).parent
    env = dict(os.environ)
    extra = [prefix, prefix / "Library" / "bin", prefix / "Scripts"]
    env["PATH"] = os.pathsep.join([str(p) for p in extra] + [env.get("PATH", "")])
    env["PYTHONUTF8"] = "1"
    env.pop("PYTHONPATH", None)
    return env


class IrServer:
    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self._lock = threading.Lock()
        self._seq = 0
        self._last_used = time.monotonic()
        threading.Thread(target=self._idle_loop, daemon=True).start()

    # ── process management ──────────────────────────────────────────────
    def _start(self) -> None:
        log_dir = Path(PFFDTD_FREE_DIR)
        log_dir.mkdir(parents=True, exist_ok=True)
        log = open(log_dir / "ir_server.log", "a", encoding="utf-8")
        self._lines = queue.Queue()
        self._proc = subprocess.Popen(
            [PFFDTD_PYTHON, "-I", PFFDTD_IR_SERVER_SCRIPT, "--parent-pid", str(os.getpid())],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, env=_server_env(),
            text=True, encoding="utf-8", errors="replace", bufsize=1,
        )
        threading.Thread(target=self._pump, args=(self._proc, self._lines), daemon=True).start()
        line = self._next_line(PFFDTD_IR_SERVER_START_TIMEOUT_S)
        while line is not None and line.strip() != READY:
            line = self._next_line(PFFDTD_IR_SERVER_START_TIMEOUT_S)
        if line is None:
            self._stop()
            raise IrServerError(f"the IR server did not start (log: {log_dir / 'ir_server.log'})")

    @staticmethod
    def _pump(proc: subprocess.Popen, lines: "queue.Queue[Optional[str]]") -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)  # EOF: the process exited

    def _next_line(self, timeout: float) -> Optional[str]:
        try:
            return self._lines.get(timeout=timeout)
        except queue.Empty:
            return None

    def _stop(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            try:
                proc.kill()
                proc.wait(timeout=5)
            except Exception:
                pass

    def _idle_loop(self) -> None:
        while True:
            time.sleep(IDLE_CHECK_S)
            if self._proc is None or not self._lock.acquire(blocking=False):
                continue
            try:
                if time.monotonic() - self._last_used > PFFDTD_IR_SERVER_IDLE_S:
                    self._stop()
            finally:
                self._lock.release()

    # ── requests ────────────────────────────────────────────────────────
    def render(self, free_dir: Path, point: int, fixed: list[int], out_paths: list[Path],
               is_current: Callable[[], bool] = lambda: True) -> float:
        """Write the point's IR for each fixed index; returns the server time in ms."""
        with self._lock:
            if not is_current():
                raise Superseded()
            self._last_used = time.monotonic()
            if self._proc is None or self._proc.poll() is not None:
                self._start()
            self._seq += 1
            req = {"id": self._seq, "free_dir": str(free_dir), "point": int(point),
                   "fixed": [int(f) for f in fixed], "out_paths": [str(p) for p in out_paths]}
            assert self._proc is not None and self._proc.stdin is not None
            try:
                self._proc.stdin.write(json.dumps(req) + "\n")
                self._proc.stdin.flush()
            except OSError as exc:
                self._stop()
                raise IrServerError(f"the IR server stopped: {exc}") from exc
            deadline = time.monotonic() + PFFDTD_IR_SERVER_REQUEST_TIMEOUT_S
            while True:
                line = self._next_line(max(0.0, deadline - time.monotonic()))
                if line is None:
                    self._stop()
                    raise IrServerError("the IR server timed out or exited")
                if not line.startswith(PREFIX):
                    continue
                reply = json.loads(line[len(PREFIX):])
                if reply.get("id") != self._seq:
                    continue
                self._last_used = time.monotonic()
                if not reply.get("ok"):
                    raise IrServerError(reply.get("error") or "IR rendering failed")
                return float(reply.get("ms", 0.0))


ir_server = IrServer()
