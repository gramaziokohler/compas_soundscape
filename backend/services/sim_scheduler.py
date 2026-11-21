"""Simulation scheduler: which card simulation runs next, and with how many processes.

Card simulations (``SIMULATION_VARIANTS`` of the pyroomacoustics job type) do not wait in the
shared CPU queue. Each workspace has its own list, ``SIM_QUEUE_PREFIX + <workspace>``, and a CPU
worker's simulation slot leases through ``WorkerJobStore.lease_simulation``:

* at most ``SIM_MAX_CONCURRENT`` simulations run at once on the host;
* a further one starts only while ``SIM_START_MIN_FREE_GB`` of RAM is free;
* the next one comes from the workspace with the fewest simulations running (ties: the oldest
  head job), oldest first within a workspace, so one user's batch finishes job by job and other
  users still get their turn.

``simulation_processes`` sizes a job's process pool from the RAM free when it starts and the
predicted response length (benchmark of 2026-11-21, see config/constants.py).

The functions here are pure; job_store.py holds the Redis side.
"""

from __future__ import annotations

import math
from typing import Optional

from config.constants import (
    JOB_TYPE_PYROOMACOUSTICS,
    JOB_TYPE_QUEUE,
    SIM_MEMORY_GB_PER_RESPONSE_S,
    SIM_MEMORY_PER_PROCESS_MIN_GB,
    SIM_MEMORY_RESERVE_GB,
    SIM_QUEUE_PREFIX,
    SIM_RESPONSE_MAX_S,
    SIM_RESPONSE_OFFSET_S,
    SIM_RESPONSE_T60_FACTOR,
    SIMULATION_VARIANTS,
)


def is_simulation(job_type: str, payload: Optional[dict]) -> bool:
    """A card simulation, scheduled by this module (not a preflight, path view or preview)."""
    return job_type == JOB_TYPE_PYROOMACOUSTICS and (payload or {}).get("variant") in SIMULATION_VARIANTS


def sim_queue_key(session_id: str) -> str:
    return SIM_QUEUE_PREFIX + (session_id or "")


def queue_for(job_type: str, payload: Optional[dict], session_id: Optional[str]) -> Optional[str]:
    """The Redis list a new job waits in; None for IO job types (they never queue)."""
    if is_simulation(job_type, payload):
        return sim_queue_key(session_id or "")
    return JOB_TYPE_QUEUE.get(job_type)


def is_sim_queue(queue_key: Optional[str]) -> bool:
    return bool(queue_key) and queue_key.startswith(SIM_QUEUE_PREFIX)


def pick_workspace(waiting: dict[str, float], running: dict[str, int]) -> Optional[str]:
    """The workspace whose head simulation runs next.

    ``waiting``: workspace -> creation time of its oldest queued simulation.
    ``running``: workspace -> simulations it has running.
    Fewest running first, then the oldest waiting job.
    """
    if not waiting:
        return None
    return min(waiting, key=lambda ws: (running.get(ws, 0), waiting[ws]))


def queue_position(index: int, workspace: str, lengths: dict[str, int]) -> tuple[int, int]:
    """(position, total) of the simulation at ``index`` in its workspace's list.

    Approximates the fair order: before it run the ``index`` older jobs of its own workspace and,
    from every other workspace, at most ``index + 1`` jobs (one per turn).
    """
    ahead = index + sum(min(n, index + 1) for ws, n in lengths.items() if ws != workspace)
    return ahead + 1, sum(lengths.values())


def predicted_response_s(t60: Optional[float]) -> Optional[float]:
    if not t60 or not math.isfinite(t60) or t60 <= 0:
        return None
    return min(SIM_RESPONSE_MAX_S, SIM_RESPONSE_T60_FACTOR * t60 + SIM_RESPONSE_OFFSET_S)


def simulation_processes(max_processes: int, available_gb: Optional[float], t60: Optional[float]) -> int:
    """Processes for one simulation: ``max_processes``, fewer when its predicted peak would not fit
    in the RAM free now (minus ``SIM_MEMORY_RESERVE_GB``). Unknown RAM or T60: ``max_processes``
    (a missing T60 still applies the per-process minimum)."""
    if available_gb is None:
        return max(1, max_processes)
    response = predicted_response_s(t60)
    per_process = max(SIM_MEMORY_PER_PROCESS_MIN_GB, SIM_MEMORY_GB_PER_RESPONSE_S * (response or 0.0))
    fit = int((available_gb - SIM_MEMORY_RESERVE_GB) // per_process)
    return max(1, min(max_processes, fit))


def available_memory_gb() -> Optional[float]:
    """RAM free on this host, or None when psutil is unavailable."""
    try:
        import psutil
    except ImportError:
        return None
    return psutil.virtual_memory().available / 2**30
