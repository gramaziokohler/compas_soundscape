"""GPU memory sharing between the PFFDTD wave solver and the Stable Audio 3 worker (Redis keys).

The wave solve gets as much GPU memory as possible; a sound generation runs during a solve only when
the memory left covers it.

- ``WaveGpuClaim`` (PFFDTD job process, around the pipeline): sets GPU_WAVE_CLAIM_KEY = {need_bytes}
  with a TTL refreshed by a thread (a crashed job frees the GPU within the TTL), and waits up to
  GPU_WAVE_CLAIM_WAIT_S for a resident SA3 worker to move its weights to system RAM.
- The SA3 worker (workers/sa3_runner.py) publishes SA3_GPU_STATE_KEY, offloads when
  ``sa3_should_offload()`` (a claim whose grid + a generation peak no longer fit beside it), and
  restores for a job only if ``sa3_may_restore()``: free memory >= SA3 + the claim's grid. The
  check counts the grid as not yet allocated even when the solve already holds it: a multi-source
  solve frees and re-allocates between sources, and SA3 must not take that gap.

Sync Redis only: used by the PFFDTD job subprocess (compas-toy) and the SA3 worker (compas-sa3).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import uuid
from typing import Optional

import redis

from config.constants import (
    GPU_WAVE_CLAIM_KEY,
    GPU_WAVE_CLAIM_MARGIN_BYTES,
    GPU_WAVE_CLAIM_REFRESH_S,
    GPU_WAVE_CLAIM_TTL_S,
    GPU_WAVE_CLAIM_WAIT_S,
    PFFDTD_LIVE_BUDGET_FRACTION,
    REDIS_URL,
    SA3_GPU_NEED_BYTES,
    SA3_GPU_PEAK_BYTES,
    SA3_GPU_MOVABLE_KEY,
    SA3_GPU_STATE_KEY,
)
from utils.pffdtd_grid import static_gpu_budget_bytes

SA3_RESIDENT = "resident"
SA3_OFFLOADED = "offloaded"


def gpu_memory() -> Optional[tuple[int, int]]:
    """(total, free) bytes of GPU 0 (whole device, nvidia-smi); None if it cannot be read."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        total, free = (int(v) * 2 ** 20 for v in out.splitlines()[0].split(","))
        return total, free
    except Exception:
        return None


def free_gpu_bytes() -> Optional[int]:
    """Free memory of GPU 0 (whole device, nvidia-smi); None if it cannot be read."""
    mem = gpu_memory()
    return None if mem is None else mem[1]


def wave_claim(r: "redis.Redis") -> Optional[dict]:
    raw = r.get(GPU_WAVE_CLAIM_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return {"need_bytes": 0}


def sa3_may_restore(r: "redis.Redis") -> bool:
    """True when SA3 may move back to the GPU: no wave claim, or room for SA3 and the claim's grid."""
    claim = wave_claim(r)
    if claim is None:
        return True
    free = free_gpu_bytes()
    return free is not None and free >= SA3_GPU_NEED_BYTES + int(claim.get("need_bytes", 0))


def sa3_should_offload(r: "redis.Redis") -> bool:
    """True when resident SA3 weights are in the way: a claim whose grid plus a generation peak exceed
    the free memory (unknown free memory counts as in the way)."""
    claim = wave_claim(r)
    if claim is None:
        return False
    free = free_gpu_bytes()
    return free is None or free < int(claim.get("need_bytes", 0)) + SA3_GPU_PEAK_BYTES


def publish_sa3_state(r: "redis.Redis", state: str, ttl_s: int, movable_bytes: int = 0) -> None:
    """Where SA3's weights are and the GPU bytes it would release by moving them to system RAM."""
    r.set(SA3_GPU_STATE_KEY, state, ex=ttl_s)
    r.set(SA3_GPU_MOVABLE_KEY, int(movable_bytes if state == SA3_RESIDENT else 0), ex=ttl_s)


def wave_gpu_budget(r: Optional["redis.Redis"] = None) -> dict:
    """GPU memory a wave solve can use now (bytes). A running solve's claim is counted as available: it
    is released when that solve ends, before the next one starts (one PFFDTD slot).

    available = (free + SA3's movable bytes + a running claim - claim margin) x PFFDTD_LIVE_BUDGET_FRACTION;
    the static PFFDTD_GPU_MEMORY_GB budget when nvidia-smi cannot be read."""
    mem = gpu_memory()
    if mem is None:
        return {"source": "static", "available_bytes": static_gpu_budget_bytes(), "total_bytes": None,
                "free_bytes": None, "sa3_movable_bytes": 0, "solve_running": False}
    total, free = mem
    movable, claim = 0, None
    try:
        r = r or redis.Redis.from_url(REDIS_URL, decode_responses=True)
        if r.get(SA3_GPU_STATE_KEY) == SA3_RESIDENT:
            movable = int(r.get(SA3_GPU_MOVABLE_KEY) or 0)
        claim = wave_claim(r)
    except Exception as exc:   # Redis down: free memory only
        print(f"[gpu-budget] Redis unavailable ({exc}); counting free memory only")
    running = int(claim.get("need_bytes", 0)) if claim else 0
    available = int(max(0, free + movable + running - GPU_WAVE_CLAIM_MARGIN_BYTES) * PFFDTD_LIVE_BUDGET_FRACTION)
    return {"source": "live", "available_bytes": available, "total_bytes": total, "free_bytes": free,
            "sa3_movable_bytes": movable, "solve_running": claim is not None}


def wave_gpu_budget_bytes() -> int:
    return int(wave_gpu_budget()["available_bytes"])


class WaveGpuClaim:
    """Context manager held by a PFFDTD job while its pipeline (voxelisation + GPU solve) runs."""

    def __init__(self, grid_bytes: int, label: str = "", url: str = REDIS_URL):
        self.need_bytes = int(grid_bytes) + GPU_WAVE_CLAIM_MARGIN_BYTES
        self.label = label
        self.url = url
        self.token = uuid.uuid4().hex
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._r: Optional[redis.Redis] = None

    def _value(self) -> str:
        return json.dumps({"need_bytes": self.need_bytes, "token": self.token, "pid": os.getpid(), "label": self.label})

    def _refresh(self) -> None:
        while not self._stop.wait(GPU_WAVE_CLAIM_REFRESH_S):
            try:
                self._r.set(GPU_WAVE_CLAIM_KEY, self._value(), ex=GPU_WAVE_CLAIM_TTL_S)
            except Exception as exc:
                print(f"[gpu-claim] refresh failed: {exc}")

    def __enter__(self) -> "WaveGpuClaim":
        try:
            self._r = redis.Redis.from_url(self.url, decode_responses=True)
            self._r.set(GPU_WAVE_CLAIM_KEY, self._value(), ex=GPU_WAVE_CLAIM_TTL_S)
        except Exception as exc:   # Redis down: run without coordination
            print(f"[gpu-claim] could not claim the GPU ({exc}); running without SA3 offload")
            self._r = None
            return self
        self._thread = threading.Thread(target=self._refresh, daemon=True)
        self._thread.start()
        t0 = time.time()
        while time.time() - t0 < GPU_WAVE_CLAIM_WAIT_S:
            if self._r.get(SA3_GPU_STATE_KEY) != SA3_RESIDENT:   # offloaded, or no SA3 worker
                break
            free = free_gpu_bytes()
            if free is not None and free >= self.need_bytes + SA3_GPU_PEAK_BYTES:   # SA3 may stay
                break
            time.sleep(0.5)
        else:
            print(f"[gpu-claim] SA3 still on the GPU after {GPU_WAVE_CLAIM_WAIT_S}s (busy generating?); solving anyway")
        print(f"[gpu-claim] claimed {self.need_bytes / 1e9:.2f} GB for {self.label or 'a wave solve'} "
              f"after {time.time() - t0:.1f}s")
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._r is None:
            return
        try:
            if (wave_claim(self._r) or {}).get("token") == self.token:   # another solve may own it now
                self._r.delete(GPU_WAVE_CLAIM_KEY)
        except Exception as e:
            print(f"[gpu-claim] release failed (expires in {GPU_WAVE_CLAIM_TTL_S}s): {e}")
