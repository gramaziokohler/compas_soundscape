"""Atomic JSON files shared between a job process and the worker that polls it.

The worker reads a job's progress file every few hundred milliseconds. On Windows a file that is
open cannot be replaced, so ``os.replace`` onto it fails with ``[WinError 5] Access is denied``
while the worker (or an antivirus scan) holds it. Each write therefore goes through its own temp
file (two threads of one job never share one) and retries the replace:

- ``write_json`` (results, payloads) keeps retrying and raises if the file stays locked;
- ``write_progress_json`` gives up quietly: a progress report is superseded by the next one, and
  losing one must never fail the job.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

from config.constants import (
    ATOMIC_JSON_PROGRESS_RETRIES,
    ATOMIC_JSON_RESULT_RETRIES,
    ATOMIC_JSON_RETRY_DELAY_S,
)


def _replace(tmp: str, path: str, retries: int) -> bool:
    """Move ``tmp`` onto ``path``; False if ``path`` stayed locked for every attempt (``tmp`` removed)."""
    for attempt in range(retries):
        try:
            os.replace(tmp, path)
            return True
        except PermissionError:
            if attempt < retries - 1:
                time.sleep(ATOMIC_JSON_RETRY_DELAY_S * (attempt + 1))
    try:
        os.remove(tmp)
    except OSError:
        pass
    return False


def _write_tmp(path: str, payload: Any) -> str:
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return tmp


def write_json(path: str, payload: Any) -> None:
    """Write ``payload`` to ``path`` atomically; raises PermissionError if ``path`` stays locked."""
    if not _replace(_write_tmp(path, payload), path, ATOMIC_JSON_RESULT_RETRIES):
        raise PermissionError(f"{path} stayed locked by another process")


def write_progress_json(path: str, payload: Any) -> bool:
    """Write ``payload`` to ``path`` atomically if it can be replaced soon; False when this report was dropped."""
    return _replace(_write_tmp(path, payload), path, ATOMIC_JSON_PROGRESS_RETRIES)
