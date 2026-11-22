"""GPU sharing between the PFFDTD wave solver and the Stable Audio 3 worker (services/gpu_arbiter.py,
workers/sa3_runner.py): claim, offload, restore, waiting job. Free GPU memory is faked."""
from __future__ import annotations

import sys
import threading
import time
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.constants import GPU_WAVE_CLAIM_KEY, SA3_GPU_PEAK_BYTES, SA3_GPU_NEED_BYTES, SA3_GPU_STATE_KEY  # noqa: E402
from services import gpu_arbiter as arb  # noqa: E402

GB = 10 ** 9


class FakeRedis:
    """get/set(ex)/delete, enough for the arbiter (TTL ignored)."""

    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ex=None):
        self.d[k] = v

    def delete(self, k):
        self.d.pop(k, None)


@pytest.fixture
def redis_and_free(monkeypatch):
    r = FakeRedis()
    free = {"bytes": 8 * GB}
    monkeypatch.setattr(arb, "free_gpu_bytes", lambda: free["bytes"])
    monkeypatch.setattr(arb.redis.Redis, "from_url", staticmethod(lambda *a, **k: r))
    monkeypatch.setattr(arb, "GPU_WAVE_CLAIM_WAIT_S", 2)
    return r, free


def test_no_claim_means_resident(redis_and_free):
    r, _ = redis_and_free
    assert not arb.sa3_should_offload(r)
    assert arb.sa3_may_restore(r)


def test_small_solve_leaves_sa3_on_the_gpu(redis_and_free):
    r, free = redis_and_free
    free["bytes"] = 6 * GB
    r.set(SA3_GPU_STATE_KEY, arb.SA3_RESIDENT)
    t0 = time.time()
    with arb.WaveGpuClaim(2 * GB) as claim:   # 2.4 GB with the margin + 0.8 GB peak < 6 GB
        assert time.time() - t0 < 1.0           # no wait for SA3
        assert not arb.sa3_should_offload(r)
        assert arb.wave_claim(r)["need_bytes"] == claim.need_bytes
    assert r.get(GPU_WAVE_CLAIM_KEY) is None


def test_large_solve_offloads_and_blocks_restore(redis_and_free):
    r, free = redis_and_free
    free["bytes"] = 5 * GB
    r.set(GPU_WAVE_CLAIM_KEY, '{"need_bytes": %d}' % (5 * GB))
    assert arb.sa3_should_offload(r)
    free["bytes"] = 7 * GB                       # SA3 moved to RAM
    assert not arb.sa3_may_restore(r)            # 7 < 3 + 5
    free["bytes"] = SA3_GPU_NEED_BYTES + 5 * GB  # e.g. after other memory was freed
    assert arb.sa3_may_restore(r)
    assert SA3_GPU_PEAK_BYTES < SA3_GPU_NEED_BYTES


def test_claim_waits_for_resident_sa3_then_releases(redis_and_free):
    r, free = redis_and_free
    free["bytes"] = 3 * GB
    r.set(SA3_GPU_STATE_KEY, arb.SA3_RESIDENT)

    def worker_offloads():
        time.sleep(0.6)
        r.set(SA3_GPU_STATE_KEY, arb.SA3_OFFLOADED)

    threading.Thread(target=worker_offloads).start()
    t0 = time.time()
    with arb.WaveGpuClaim(6 * GB):
        waited = time.time() - t0
    assert 0.5 <= waited < 1.9
    assert r.get(GPU_WAVE_CLAIM_KEY) is None


def test_release_keeps_another_solves_claim(redis_and_free):
    r, _ = redis_and_free
    with arb.WaveGpuClaim(GB):
        r.set(GPU_WAVE_CLAIM_KEY, '{"need_bytes": 1, "token": "other"}')
    assert r.get(GPU_WAVE_CLAIM_KEY) is not None


def _sa3_runner(r):
    """Sa3Runner with fake service/job store (no torch, no compas-sa3 env)."""
    sys.modules.setdefault("services.stable_audio_service", types.SimpleNamespace(
        StableAudioService=object, StableAudioCancelled=Exception))
    from workers import sa3_runner

    class Service:
        def __init__(self):
            self.on_gpu = True
            self.moves = []

        def offload(self):
            self.on_gpu = False
            self.moves.append("ram")

        def restore(self):
            self.on_gpu = True
            self.moves.append("gpu")

        def gpu_bytes(self):
            return 2 * GB if self.on_gpu else 0

    class Store:
        redis = r
        texts = []
        cancelled = set()

        def is_cancel_requested(self, jid):
            return jid in self.cancelled

        def mark_cancelled(self, jid):
            self.texts.append("cancelled")

        def set_progress(self, jid, v, text, partial=None):
            self.texts.append(text)

    state = types.SimpleNamespace(should_stop=lambda jid: False)
    runner = sa3_runner.Sa3Runner(Store(), state, "t")
    runner.service = Service()
    return runner, sa3_runner


def test_sa3_runner_offloads_waits_and_restores(redis_and_free, monkeypatch):
    r, free = redis_and_free
    runner, mod = _sa3_runner(r)
    monkeypatch.setattr(mod, "SA3_GPU_WAIT_POLL_S", 0.05)
    runner._sync_gpu()
    assert r.get(SA3_GPU_STATE_KEY) == arb.SA3_RESIDENT

    free["bytes"] = 2 * GB
    r.set(GPU_WAVE_CLAIM_KEY, '{"need_bytes": %d}' % (6 * GB))
    runner._sync_gpu()
    assert runner.service.moves == ["ram"] and r.get(SA3_GPU_STATE_KEY) == arb.SA3_OFFLOADED

    job = types.SimpleNamespace(job_id="j1")
    done = []
    th = threading.Thread(target=lambda: done.append(runner._wait_for_gpu(job)))
    th.start()
    time.sleep(0.3)
    assert not done and any("Waiting for GPU memory" in t for t in runner.job_store.texts)
    r.delete(GPU_WAVE_CLAIM_KEY)                 # the solve finished
    th.join(2)
    assert done == [True] and runner.service.moves == ["ram", "gpu"]
    assert r.get(SA3_GPU_STATE_KEY) == arb.SA3_RESIDENT


def test_sa3_runner_cancel_while_waiting(redis_and_free, monkeypatch):
    r, free = redis_and_free
    runner, mod = _sa3_runner(r)
    monkeypatch.setattr(mod, "SA3_GPU_WAIT_POLL_S", 0.05)
    free["bytes"] = GB
    r.set(GPU_WAVE_CLAIM_KEY, '{"need_bytes": %d}' % (6 * GB))
    runner._sync_gpu()
    runner.job_store.cancelled.add("j2")
    assert runner._wait_for_gpu(types.SimpleNamespace(job_id="j2")) is False
    assert "cancelled" in runner.job_store.texts


def test_wave_budget_counts_free_sa3_and_a_running_solve(redis_and_free, monkeypatch):
    r, free = redis_and_free
    monkeypatch.setattr(arb, "gpu_memory", lambda: (11 * GB, 4 * GB))
    base = arb.wave_gpu_budget(r)
    assert base["source"] == "live" and not base["solve_running"]
    arb.publish_sa3_state(r, arb.SA3_RESIDENT, 30, 2 * GB)
    with_sa3 = arb.wave_gpu_budget(r)
    assert with_sa3["sa3_movable_bytes"] == 2 * GB
    assert with_sa3["available_bytes"] > base["available_bytes"]
    arb.publish_sa3_state(r, arb.SA3_OFFLOADED, 30, 2 * GB)   # in RAM already: nothing more to release
    assert arb.wave_gpu_budget(r)["sa3_movable_bytes"] == 0
    r.set(GPU_WAVE_CLAIM_KEY, '{"need_bytes": %d}' % (3 * GB))
    running = arb.wave_gpu_budget(r)
    assert running["solve_running"] and running["available_bytes"] > base["available_bytes"]


def test_wave_budget_falls_back_to_the_static_budget(monkeypatch):
    monkeypatch.setattr(arb, "gpu_memory", lambda: None)
    b = arb.wave_gpu_budget(FakeRedis())
    assert b["source"] == "static" and b["available_bytes"] == arb.static_gpu_budget_bytes()
