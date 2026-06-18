"""
Unified backend task queue with dedicated worker pools.

Three pools to maximise throughput without VRAM conflicts:
  GPU_POOL  — serial (1 worker); sound generation on RTX 3080 (10 GB VRAM)
  IO_POOL   — concurrent (6 workers); LLM API calls, model analysis, SSE streaming
  CPU_POOL  — concurrent (2 workers); Pyroomacoustics, Choras, YAMNet SED

All pools use ThreadPoolExecutor because the actual heavy computation
happens inside subprocesses (multiprocessing.Process).  The pool threads
simply coordinate subprocesses and poll progress files, so the GIL is
not a bottleneck.
"""
from __future__ import annotations

import collections
import json
import multiprocessing
import threading
import time
import traceback
from dataclasses import dataclass, field as dc_field
from concurrent.futures import ThreadPoolExecutor, Future
from pathlib import Path
from typing import Any, Callable, Deque, Dict, Optional, Tuple


# ── Pool definitions ───────────────────────────────────────────────────────────
# GPU-bound: serial — one job at a time, RTX 3080 has 10 GB VRAM
GPU_POOL: ThreadPoolExecutor = ThreadPoolExecutor(max_workers=1)

# I/O-bound: LLM API calls, external library search (network-limited, not GPU)
IO_POOL: ThreadPoolExecutor = ThreadPoolExecutor(max_workers=6)

# CPU-bound: Pyroomacoustics, Choras, YAMNet
CPU_POOL: ThreadPoolExecutor = ThreadPoolExecutor(max_workers=2)

POOL_MAP: Dict[str, ThreadPoolExecutor] = {
    "sound":           GPU_POOL,
    "llm":             IO_POOL,
    "model_analysis":  IO_POOL,
    "analyze_stream":  IO_POOL,
    "scenario":        IO_POOL,
    "foley":           IO_POOL,
    "sed":             CPU_POOL,
    "pyroomacoustics": CPU_POOL,
    "choras":          CPU_POOL,
    "tts":             IO_POOL,
}


@dataclass
class UnifiedTask:
    """State object shared between the queue consumer and polling endpoints."""
    task_id: str
    task_type: str          # "sound" | "llm" | "pyroomacoustics" | "choras" | "sed" | ...
    progress: int = 0
    status: str = "Queued"
    completed: bool = False
    cancelled: bool = False
    error: Optional[str] = None
    result: Any = None
    partial_sounds: Optional[list] = None   # sound generation only
    cancel_event: threading.Event = dc_field(default_factory=threading.Event)
    process: Optional[Any] = None           # live subprocess reference for hard-kill
    cleanup_delay: int = 600


class UnifiedTaskQueue:
    """Multi-pool task queue with dedicated workers per workload type."""

    def __init__(self) -> None:
        self._tasks: Dict[str, UnifiedTask] = {}
        self._tasks_lock = threading.Lock()
        self._futures: Dict[str, Future] = {}
        self._lock = threading.Lock()

        self._per_pool_queue: Dict[int, Deque[str]] = {
            id(GPU_POOL): collections.deque(),
            id(IO_POOL):  collections.deque(),
            id(CPU_POOL): collections.deque(),
        }
        self._pool_by_id: Dict[int, ThreadPoolExecutor] = {
            id(GPU_POOL): GPU_POOL,
            id(IO_POOL):  IO_POOL,
            id(CPU_POOL): CPU_POOL,
        }
        self._pool_names: Dict[int, str] = {
            id(GPU_POOL): "gpu",
            id(IO_POOL):  "io",
            id(CPU_POOL): "cpu",
        }

    # ── Public API ─────────────────────────────────────────────────────────────

    def enqueue(
        self,
        task_id: str,
        task_type: str,
        run_fn: Callable[["UnifiedTask"], None],
        cleanup_delay: int = 600,
    ) -> Tuple[int, int]:
        """
        Add a job to the appropriate pool.

        run_fn(task) is called by a pool worker thread and must block until the
        job finishes or is cancelled.

        Returns (1-based position, total queue depth for that pool).
        """
        task = UnifiedTask(task_id=task_id, task_type=task_type, cleanup_delay=cleanup_delay)
        with self._tasks_lock:
            self._tasks[task_id] = task

        pool = POOL_MAP.get(task_type, IO_POOL)
        pool_id = id(pool)

        with self._lock:
            self._per_pool_queue[pool_id].append(task_id)
            pos = len(self._per_pool_queue[pool_id])
            total = pos

        def _execute() -> None:
            with self._lock:
                try:
                    self._per_pool_queue[pool_id].remove(task_id)
                except ValueError:
                    pass

            try:
                if not task.cancel_event.is_set():
                    task.progress = 0
                    task.status = "Starting..."
                    run_fn(task)
                else:
                    task.cancelled = True
                    task.completed = True
                    task.status = "Cancelled"
            except Exception as exc:
                print(
                    f"[task-queue] Unhandled error in task {task_id}: {exc}\n"
                    + traceback.format_exc()
                )
                if not task.completed:
                    task.error = str(exc)
                    task.status = "Error"
                    task.completed = True
            finally:
                threading.Timer(
                    cleanup_delay, self._cleanup_task, args=(task_id,)
                ).start()

        future = pool.submit(_execute)
        with self._lock:
            self._futures[task_id] = future

        task.status = f"Queued — position {pos} of {total}"
        return pos, total

    def get_task(self, task_id: str) -> Optional[UnifiedTask]:
        with self._tasks_lock:
            return self._tasks.get(task_id)

    def get_queue_status(self, task_id: str) -> Tuple[Optional[int], Optional[int]]:
        """(1-based position, total).  Position is None when the job is running."""
        task = self.get_task(task_id)
        if not task:
            return (None, None)

        pool = POOL_MAP.get(task.task_type, IO_POOL)
        pool_id = id(pool)

        with self._lock:
            queue = self._per_pool_queue[pool_id]
            if task_id in queue:
                pos = list(queue).index(task_id) + 1
                total = len(queue)
                return (pos, total)
            # Currently running (or already completed)
            return (None, len(queue))

    def cancel(self, task_id: str) -> bool:
        """Signal cancellation and hard-kill any running subprocess."""
        task = self.get_task(task_id)
        if not task:
            return False
        task.cancel_event.set()
        task.cancelled = True
        task.status = "Cancelled"
        if task.process is not None:
            try:
                if task.process.is_alive():
                    task.process.kill()
            except Exception:
                pass
        return True

    def enqueue_with_ready_signal(
        self,
        task_id: str,
        task_type: str,
        loop: "asyncio.AbstractEventLoop",
        cleanup_delay: int = 600,
    ) -> "Tuple[int, int, asyncio.Event, threading.Event]":
        """Enqueue an inline async-stream task without a subprocess.

        The pool worker thread will:
          1. Signal *ready_event* (asyncio-safe) when the task's turn arrives.
          2. Block on *done_event* until the SSE handler sets it on completion.

        Returns:
            (1-based queue position, queue total, ready_event, done_event)
        """
        import asyncio as _asyncio

        ready_event = _asyncio.Event()
        done_event = threading.Event()

        def run_fn(task: UnifiedTask) -> None:
            # Wake up the SSE generator waiting in the asyncio loop.
            loop.call_soon_threadsafe(ready_event.set)
            # Block the pool worker until the SSE generator finishes (or is cancelled).
            while not done_event.wait(timeout=1.0):
                if task.cancel_event.is_set():
                    break
            task.completed = True
            task.status = "Cancelled" if task.cancel_event.is_set() else "Completed"

        pos, total = self.enqueue(task_id, task_type, run_fn, cleanup_delay)
        return pos, total, ready_event, done_event

    def get_pool_depths(self) -> Dict[str, int]:
        """Return pending counts for each pool (used by /api/queue/status)."""
        with self._lock:
            return {
                name: len(self._per_pool_queue[pid])
                for pid, name in self._pool_names.items()
            }

    # ── Internal ───────────────────────────────────────────────────────────────

    def _cleanup_task(self, task_id: str) -> None:
        with self._tasks_lock:
            self._tasks.pop(task_id, None)
        with self._lock:
            self._futures.pop(task_id, None)


# ── Module-level singleton ──────────────────────────────────────────────────────

unified_queue = UnifiedTaskQueue()


# ── Helper factory for subprocess-based workers ────────────────────────────────

def make_subprocess_runner(
    worker_fn: Callable,
    kwargs: dict,
    progress_file: str,
    result_file: str,
    error_prefix: str = "process",
) -> Callable[["UnifiedTask"], None]:
    """
    Return a run_fn for multiprocessing.Process-based workers
    (sound, LLM, pyroomacoustics, SED).

    Starts the subprocess, polls the JSON progress file while it runs, and
    reads the result JSON when it exits.  Handles cancellation via
    task.cancel_event (hard-kills the subprocess).
    """
    def _run(task: UnifiedTask) -> None:
        process = multiprocessing.Process(
            target=worker_fn, kwargs=kwargs, daemon=True
        )
        process.start()
        task.process = process

        while process.is_alive():
            time.sleep(0.5)
            if task.cancel_event.is_set():
                try:
                    process.kill()
                except Exception:
                    pass
                task.cancelled = True
                task.completed = True
                task.status = "Cancelled"
                break
            try:
                with open(progress_file) as _f:
                    prog = json.load(_f)
                task.progress = prog["value"]
                task.status = prog["status"]
                if "partial_sounds" in prog:
                    task.partial_sounds = prog["partial_sounds"]
            except Exception:
                pass

        process.join(timeout=2)

        if not task.completed:
            try:
                with open(result_file) as _f:
                    result = json.load(_f)
                if result["type"] == "done":
                    task.result = result["result"]
                    task.progress = 100
                    task.status = "Completed"
                    task.completed = True
                elif result["type"] == "error":
                    task.error = result["message"]
                    task.status = "Error"
                    task.completed = True
            except Exception:
                if task.cancel_event.is_set():
                    task.cancelled = True
                    task.status = "Cancelled"
                else:
                    task.error = f"{error_prefix} terminated unexpectedly"
                    task.status = "Error"
                task.completed = True

        try:
            Path(progress_file).unlink(missing_ok=True)
        except Exception:
            pass

    return _run
