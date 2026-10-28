"""
Process pool for work split inside a CPU job's child process.

The job child is daemonic (``workers/_subprocess_common.py``) and is hard-killed
on cancel, so the pool's workers:

* are started with the daemon flag lifted (``multiprocessing`` refuses children
  of a daemonic process) and watch their parent instead: they exit as soon as
  the job child is gone, so a cancelled job leaves no orphans;
* are spawned with ``__main__`` hidden, otherwise every worker re-imports the
  worker entry point (``workers.worker_main`` and every runner it imports)
  before it can run a task.
"""

from __future__ import annotations

import contextlib
import multiprocessing
import os
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Iterator


def _exit_when_parent_dies(parent_pid: int) -> None:
    if sys.platform == "win32":
        import ctypes

        synchronize = 0x00100000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(synchronize, False, parent_pid)
        if handle:
            kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
        os._exit(1)
    while os.getppid() == parent_pid:
        time.sleep(1.0)
    os._exit(1)


def _init_worker(parent_pid: int) -> None:
    threading.Thread(target=_exit_when_parent_dies, args=(parent_pid,), daemon=True).start()


@contextlib.contextmanager
def _children_allowed() -> Iterator[None]:
    config = getattr(multiprocessing.current_process(), "_config", None)
    was_daemon = bool(config and config.get("daemon"))
    if was_daemon:
        config["daemon"] = False

    main = sys.modules.get("__main__")
    hidden = {name: getattr(main, name) for name in ("__spec__", "__file__") if hasattr(main, name)}
    for name in hidden:
        if name == "__spec__":
            main.__spec__ = None
        else:
            del main.__file__
    try:
        yield
    finally:
        for name, value in hidden.items():
            setattr(main, name, value)
        if was_daemon:
            config["daemon"] = True


class ChildPool:
    """``submit`` starts workers on demand, so it runs with children allowed."""

    def __init__(self, n_workers: int):
        self._pool = ProcessPoolExecutor(
            max_workers=n_workers,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=_init_worker,
            initargs=(os.getpid(),),
        )

    def submit(self, fn, *args):
        with _children_allowed():
            return self._pool.submit(fn, *args)

    def close(self, failed: bool) -> None:
        if failed:
            # Running tasks can take minutes and nobody needs their result any more.
            for process in list(getattr(self._pool, "_processes", {}).values()):
                with contextlib.suppress(Exception):
                    process.kill()
        self._pool.shutdown(wait=not failed, cancel_futures=True)


@contextlib.contextmanager
def child_pool(n_workers: int) -> Iterator[ChildPool]:
    pool = ChildPool(n_workers)
    failed = True
    try:
        yield pool
        failed = False
    finally:
        pool.close(failed)
