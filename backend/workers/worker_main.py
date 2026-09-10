"""
Worker process entry point.

python -m workers.worker_main --role gpu|cpu|choras --slots N --worker-id X

Responsibilities shared across all roles:
  - own a WorkerJobStore (sync redis client)
  - run a background heartbeat thread (WORKER_HEARTBEAT_INTERVAL_S)
  - subscribe to the job:cancel pub/sub channel and flag cancellation for the
    job currently being processed
  - graceful shutdown on Ctrl+C / Ctrl+Break (nssm `stop`)

Role-specific work (leasing a queue, running the job, reporting progress)
lives in workers/gpu_runner.py, workers/cpu_runner.py, workers/choras_runner.py.
"""
from __future__ import annotations

import argparse
import os
import signal
import socket
import threading
import time

from dotenv import load_dotenv, find_dotenv

from services.job_store import WorkerJobStore
from config.constants import WORKER_HEARTBEAT_INTERVAL_S, JOB_CANCEL_CHANNEL


def _load_env_files() -> None:
    """Load the same `.env.local` / `.env` the API uses (searched upward from the
    repo, so config like TANGOFLUX_DTYPE / REDIS_URL / TANGOFLUX_* kept in the env
    file applies to workers exactly as it does to `uvicorn main:app`)."""
    _env_local = find_dotenv('.env.local', raise_error_if_not_found=False, usecwd=False)
    _env = find_dotenv('.env', raise_error_if_not_found=False, usecwd=False)
    if _env_local:
        load_dotenv(_env_local, override=True)   # admin overrides (not shipped to users)
    if _env:
        load_dotenv(_env)


class WorkerState:
    """Shared mutable state between the heartbeat/cancel-listener threads and the
    runner(s). Tracks per-job_id cancellation so a process can run several jobs
    concurrently (CPU/Choras multi-slot), not just one at a time (GPU).
    """

    def __init__(self) -> None:
        self._active: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def start_job(self, job_id: str) -> None:
        with self._lock:
            self._active[job_id] = threading.Event()

    def end_job(self, job_id: str) -> None:
        with self._lock:
            self._active.pop(job_id, None)

    def note_cancel(self, job_id: str) -> None:
        with self._lock:
            event = self._active.get(job_id)
        if event is not None:
            event.set()

    def should_stop(self, job_id: str) -> bool:
        with self._lock:
            event = self._active.get(job_id)
        return event.is_set() if event is not None else False

    def active_job_ids(self) -> list[str]:
        with self._lock:
            return list(self._active.keys())


def _heartbeat_loop(job_store: WorkerJobStore, state: WorkerState, worker_id: str, shutdown: threading.Event) -> None:
    while not shutdown.is_set():
        for job_id in state.active_job_ids():
            try:
                job_store.heartbeat(job_id, worker_id)
            except Exception as exc:
                print(f"[worker:{worker_id}] heartbeat error: {exc}")
        shutdown.wait(WORKER_HEARTBEAT_INTERVAL_S)


def _cancel_listener_loop(job_store: WorkerJobStore, state: WorkerState, worker_id: str, shutdown: threading.Event) -> None:
    """Subscribe to job:cancel and flag cancellations for running jobs.

    On Windows, `pubsub.get_message(timeout=...)` can raise redis
    ``TimeoutError`` instead of returning None; the pubsub connection can also
    drop when Redis restarts. The listener therefore survives per-poll errors by
    dropping and re-subscribing, so a transient blip never kills the thread (or
    the worker process with it).
    """
    pubsub = None
    while not shutdown.is_set():
        try:
            if pubsub is None:
                pubsub = job_store.redis.pubsub()
                pubsub.subscribe(JOB_CANCEL_CHANNEL)
            try:
                message = pubsub.get_message(timeout=1.0)
            except Exception:
                message = None
            if message and message.get("type") == "message":
                job_id = message.get("data")
                if job_id:
                    state.note_cancel(job_id)
                    print(f"[worker:{worker_id}] cancel requested for job {job_id}")
        except Exception as exc:
            print(f"[worker:{worker_id}] cancel-listener error (re-subscribing): {exc}")
            try:
                if pubsub is not None:
                    pubsub.close()
            except Exception:
                pass
            pubsub = None
            shutdown.wait(2.0)
    if pubsub is not None:
        try:
            pubsub.close()
        except Exception:
            pass


def _make_worker_id(role: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    return f"{role}-{socket.gethostname()}-{os.getpid()}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Redis job store worker process")
    parser.add_argument("--role", required=True, choices=["gpu", "cpu", "choras"])
    parser.add_argument("--slots", type=int, default=1)
    parser.add_argument("--worker-id", default=None)
    args = parser.parse_args()

    worker_id = _make_worker_id(args.role, args.worker_id)
    _load_env_files()
    job_store = WorkerJobStore()
    state = WorkerState()
    shutdown = threading.Event()

    def _handle_signal(signum, _frame):
        print(f"[worker:{worker_id}] received signal {signum}, shutting down...")
        shutdown.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, "SIGBREAK"):  # Windows Ctrl+Break (nssm stop)
        signal.signal(signal.SIGBREAK, _handle_signal)

    heartbeat_thread = threading.Thread(
        target=_heartbeat_loop, args=(job_store, state, worker_id, shutdown), daemon=True
    )
    heartbeat_thread.start()

    cancel_thread = threading.Thread(
        target=_cancel_listener_loop, args=(job_store, state, worker_id, shutdown), daemon=True
    )
    cancel_thread.start()

    print(f"[worker:{worker_id}] role={args.role} slots={args.slots} starting...")

    if args.role == "gpu":
        from workers.gpu_runner import GpuRunner

        if args.slots != 1:
            print(f"[worker:{worker_id}] warning: GPU role runs 1 slot per process; ignoring --slots={args.slots}")
        runner = GpuRunner(job_store, state, worker_id)
    elif args.role == "cpu":
        from workers.cpu_runner import CpuRunner

        runner = CpuRunner(job_store, state, worker_id, slots=args.slots)
    else:
        from workers.choras_runner import ChorasRunner

        runner = ChorasRunner(job_store, state, worker_id, slots=args.slots)

    try:
        runner.run_forever(shutdown)
    finally:
        shutdown.set()
        job_store.close()
        print(f"[worker:{worker_id}] stopped.")


if __name__ == "__main__":
    main()
