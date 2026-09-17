"""
Shared child-process-per-job executor for CPU-bound workers (cpu_runner.py,
choras_runner.py). Both job families already carry legacy subprocess worker
functions that write progress/result JSON files (see services/*_worker.py and
services/choras_job.py) — this spawns the process, polls progress_file,
forwards progress/heartbeat to Redis, and reads result_file on exit. Hard
kill on cancel (no cooperative should_stop needed for CPU-bound solvers).
"""
from __future__ import annotations

import json
import multiprocessing
import os
import threading
import time
from pathlib import Path
from typing import Callable

from services.job_store import Job, WorkerJobStore


def run_subprocess_job(
    job_store: WorkerJobStore,
    state,
    worker_id: str,
    job: Job,
    target_fn: Callable,
    kwargs: dict,
    progress_file: str,
    result_file: str,
) -> None:
    # The temp janitor prunes emptied dirs, and worker processes may run without
    # the API ever having created them — never assume temp/simulations exists.
    os.makedirs(os.path.dirname(progress_file), exist_ok=True)
    process = multiprocessing.Process(target=target_fn, kwargs=kwargs, daemon=True)
    process.start()

    try:
        while process.is_alive():
            if job_store.is_cancel_requested(job.job_id) or state.should_stop(job.job_id):
                try:
                    process.kill()
                except Exception:
                    pass
                process.join(timeout=5)
                job_store.mark_cancelled(job.job_id)
                return
            time.sleep(0.3)
            try:
                with open(progress_file) as f:
                    prog = json.load(f)
                job_store.set_progress(job.job_id, prog.get("value", 0), prog.get("status", ""))
                job_store.heartbeat(job.job_id, worker_id)
            except Exception:
                pass

        process.join(timeout=2)

        try:
            with open(result_file) as f:
                result = json.load(f)
            if result.get("type") == "done":
                job_store.complete(job.job_id, result.get("result"))
            else:
                job_store.fail(job.job_id, result.get("message", "Unknown error"))
        except Exception:
            if job_store.is_cancel_requested(job.job_id):
                job_store.mark_cancelled(job.job_id)
            else:
                job_store.fail(job.job_id, "Worker process terminated unexpectedly")
    finally:
        for f in (progress_file, result_file):
            try:
                Path(f).unlink(missing_ok=True)
            except Exception:
                pass


class MultiSlotSubprocessRunner:
    """Base for CPU/Choras runners: N threads, each independently leasing from
    one queue and running one child-process-per-job at a time. Subclasses
    provide `queue_key` and `_resolve(job) -> (target_fn, kwargs)`.
    """

    queue_key: str = ""

    def __init__(self, job_store: WorkerJobStore, state, worker_id: str, slots: int):
        self.state = state
        self.worker_id = worker_id
        self.slots = slots

    def _resolve(self, job: Job) -> tuple[Callable, dict]:
        raise NotImplementedError

    def run_forever(self, shutdown: threading.Event) -> None:
        threads = [
            threading.Thread(target=self._slot_loop, args=(i, shutdown), daemon=True)
            for i in range(self.slots)
        ]
        for t in threads:
            t.start()
        shutdown.wait()
        for t in threads:
            t.join(timeout=10)

    def _slot_loop(self, slot_index: int, shutdown: threading.Event) -> None:
        # Each slot owns its own Redis client — safe for concurrent BLPOP.
        store = WorkerJobStore()
        slot_worker_id = f"{self.worker_id}:{slot_index}"
        try:
            while not shutdown.is_set():
                try:
                    job = store.lease([self.queue_key], timeout=5)
                except Exception as exc:
                    print(f"[worker:{slot_worker_id}] lease error: {exc}")
                    time.sleep(2)
                    continue
                if job is None:
                    continue
                self.state.start_job(job.job_id)
                try:
                    target_fn, kwargs = self._resolve(job)
                    progress_file = self._progress_path(job.job_id)
                    result_file = self._result_path(job.job_id)
                    kwargs["progress_file"] = progress_file
                    kwargs["result_file"] = result_file
                    run_subprocess_job(
                        store, self.state, slot_worker_id, job, target_fn, kwargs,
                        progress_file, result_file,
                    )
                except Exception as exc:
                    print(f"[worker:{slot_worker_id}] job {job.job_id} failed: {exc}")
                    try:
                        store.fail(job.job_id, str(exc))
                    except Exception:
                        pass
                finally:
                    self.state.end_job(job.job_id)
        finally:
            store.close()

    def _progress_path(self, job_id: str) -> str:
        from config.constants import TEMP_SIMULATIONS_DIR
        return os.path.join(TEMP_SIMULATIONS_DIR, f"job_progress_{job_id}.json")

    def _result_path(self, job_id: str) -> str:
        from config.constants import TEMP_SIMULATIONS_DIR
        return os.path.join(TEMP_SIMULATIONS_DIR, f"job_result_{job_id}.json")
