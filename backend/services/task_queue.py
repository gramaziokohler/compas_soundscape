"""
Unified backend task queue.

Single FIFO queue for all heavy computation tasks:
  - Sound generation  (multiprocessing.Process + atomic JSON progress)
  - LLM generation    (multiprocessing.Process + atomic JSON progress)
  - Pyroomacoustics   (multiprocessing.Process + atomic JSON progress)
  - Choras DE/DG      (inline in consumer thread with sys.stdout capture)

All task types share one queue, so queue_position/queue_total reflect the
global backlog across every job type.
"""
from __future__ import annotations

import collections
import json
import multiprocessing
import threading
import time
import traceback
from dataclasses import dataclass, field as dc_field
from pathlib import Path
from typing import Any, Callable, Deque, Dict, Optional, Tuple


@dataclass
class UnifiedTask:
    """State object shared between the queue consumer and polling endpoints."""
    task_id: str
    task_type: str          # "sound" | "llm" | "pyroomacoustics" | "choras"
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
    """Single FIFO queue for all backend tasks."""

    def __init__(self) -> None:
        self._tasks: Dict[str, UnifiedTask] = {}
        self._tasks_lock = threading.Lock()
        self._queue: Deque[Tuple[str, Callable]] = collections.deque()
        self._active_id: Optional[str] = None
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)

        threading.Thread(
            target=self._consumer, daemon=True, name="unified-queue-consumer"
        ).start()

    # ── Public API ─────────────────────────────────────────────────────────────

    def enqueue(
        self,
        task_id: str,
        task_type: str,
        run_fn: Callable[["UnifiedTask"], None],
        cleanup_delay: int = 600,
    ) -> Tuple[int, int]:
        """
        Add a job to the queue.

        run_fn(task) is called by the consumer thread and must block until the
        job finishes or is cancelled.

        Returns (1-based position, total queue depth including running job).
        """
        task = UnifiedTask(task_id=task_id, task_type=task_type, cleanup_delay=cleanup_delay)
        with self._tasks_lock:
            self._tasks[task_id] = task

        with self._condition:
            self._queue.append((task_id, run_fn))
            total = len(self._queue) + (1 if self._active_id else 0)
            pos = len(self._queue)
            task.status = f"Queued — position {pos} of {total}"
            self._condition.notify()

        return pos, total

    def get_task(self, task_id: str) -> Optional[UnifiedTask]:
        with self._tasks_lock:
            return self._tasks.get(task_id)

    def get_queue_status(self, task_id: str) -> Tuple[Optional[int], Optional[int]]:
        """(1-based position, total).  Position is None when the job is running."""
        with self._condition:
            total = len(self._queue) + (1 if self._active_id else 0)
            if self._active_id == task_id:
                return (None, total)
            for i, (tid, _) in enumerate(self._queue):
                if tid == task_id:
                    return (i + 1, total)
        return (None, None)

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

    # ── Consumer ───────────────────────────────────────────────────────────────

    def _consumer(self) -> None:
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                task_id, run_fn = self._queue.popleft()
                self._active_id = task_id

            task = self.get_task(task_id)

            if task and not task.cancel_event.is_set():
                task.progress = 0
                task.status = "Starting..."
                try:
                    run_fn(task)
                except Exception as exc:
                    print(
                        f"[unified-queue] Unhandled error in task {task_id}: {exc}\n"
                        + traceback.format_exc()
                    )
                    if not task.completed:
                        task.error = str(exc)
                        task.status = "Error"
                        task.completed = True
            elif task:
                task.cancelled = True
                task.completed = True
                task.status = "Cancelled"

            with self._condition:
                self._active_id = None

            if task:
                threading.Timer(
                    task.cleanup_delay, self._cleanup_task, args=(task_id,)
                ).start()

    def _cleanup_task(self, task_id: str) -> None:
        with self._tasks_lock:
            self._tasks.pop(task_id, None)


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
    (sound, LLM, pyroomacoustics).

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
