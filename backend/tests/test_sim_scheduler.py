"""Simulation scheduler (services/sim_scheduler.py + WorkerJobStore.lease_simulation) and the light lane."""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import fakeredis

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from config.constants import (  # noqa: E402
    JOB_TYPE_LOOP,
    JOB_TYPE_PYROOMACOUSTICS,
    JOB_TYPE_SED,
    QUEUE_CPU_LIGHT,
    SIM_ACTIVE_KEY,
)
from services.job_store import AsyncJobStore, WorkerJobStore, job_key  # noqa: E402
from services import sim_scheduler as sched  # noqa: E402

SIM = {"variant": "pyroomacoustics_speckle", "kwargs": {}}


def make_stores():
    server = fakeredis.FakeServer()
    api = AsyncJobStore(client=fakeredis.aioredis.FakeRedis(server=server, decode_responses=True))
    worker = WorkerJobStore(client=fakeredis.FakeRedis(server=server, decode_responses=True))
    return api, worker


def run(coro):
    return asyncio.run(coro)


# ── pure policy ───────────────────────────────────────────────────────────────

def test_routing():
    assert sched.queue_for(JOB_TYPE_PYROOMACOUSTICS, SIM, "ws") == "simq:ws"
    assert sched.queue_for(JOB_TYPE_PYROOMACOUSTICS, {"variant": "pyroomacoustics_geometry"}, "ws") == "simq:ws"
    for variant in ("pyroomacoustics_preflight", "acoustic_paths", "heatmap", "pffdtd_voxel_preview"):
        assert sched.queue_for(JOB_TYPE_PYROOMACOUSTICS, {"variant": variant}, "ws") == QUEUE_CPU_LIGHT
    assert sched.queue_for(JOB_TYPE_SED, {}, "ws") == QUEUE_CPU_LIGHT
    assert sched.queue_for(JOB_TYPE_LOOP, {}, None) == QUEUE_CPU_LIGHT
    assert sched.queue_for("llm", {}, "ws") is None


def test_pick_workspace_fewest_running_then_oldest():
    assert sched.pick_workspace({}, {}) is None
    assert sched.pick_workspace({"a": 5.0, "b": 9.0}, {}) == "a"
    assert sched.pick_workspace({"a": 5.0, "b": 9.0}, {"a": 1}) == "b"
    assert sched.pick_workspace({"a": 5.0, "b": 9.0}, {"a": 1, "b": 1}) == "a"


def test_queue_position_interleaves_workspaces():
    lengths = {"a": 3, "b": 1}
    assert sched.queue_position(0, "a", lengths) == (2, 4)   # b's single job may go first
    assert sched.queue_position(2, "a", lengths) == (4, 4)
    assert sched.queue_position(0, "b", lengths) == (2, 4)


def test_simulation_processes_follow_free_memory_and_response_length():
    assert sched.simulation_processes(8, None, 9.0) == 8          # unknown RAM: unchanged
    assert sched.simulation_processes(8, 40.0, 0.65) == 8         # office-like room fits
    assert sched.simulation_processes(8, 40.0, 9.45) == 2         # hall: ~14 GB per process
    assert sched.simulation_processes(8, 20.0, None) == 4         # no T60: per-process minimum
    assert sched.simulation_processes(8, 2.0, 0.5) == 1           # never below one


# ── Redis side ────────────────────────────────────────────────────────────────

def _enqueue(api, ws, n, payload=SIM):
    async def body():
        ids = []
        for _ in range(n):
            ids.append(await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, ws, payload))
            await asyncio.sleep(0.002)  # distinct creation times
        return ids
    return run(body())


def test_simulations_wait_per_workspace_and_alternate():
    api, worker = make_stores()
    a = _enqueue(api, "a", 3)
    b = _enqueue(api, "b", 1)
    first = worker.lease_simulation(2, 0, None)
    second = worker.lease_simulation(2, 0, None)
    assert [first.job_id, second.job_id] == [a[0], b[0]]        # one per workspace
    assert worker.lease_simulation(2, 0, None) is None           # 2 running: the cap
    worker.complete(first.job_id, {})
    assert worker.lease_simulation(2, 0, None).job_id == a[1]   # then a's batch, in order


def test_one_workspace_runs_its_batch_in_order():
    api, worker = make_stores()
    a = _enqueue(api, "a", 3)
    j1 = worker.lease_simulation(1, 0, None)
    assert j1.job_id == a[0] and worker.lease_simulation(1, 0, None) is None
    worker.fail(j1.job_id, "boom")
    j2 = worker.lease_simulation(1, 0, None)
    assert j2.job_id == a[1]
    worker.mark_cancelled(j2.job_id)
    assert worker.lease_simulation(1, 0, None).job_id == a[2]


def test_second_simulation_waits_for_free_memory():
    api, worker = make_stores()
    _enqueue(api, "a", 1)
    _enqueue(api, "b", 1)
    assert worker.lease_simulation(2, 8.0, lambda: 3.0) is not None   # the first always starts
    assert worker.lease_simulation(2, 8.0, lambda: 3.0) is None        # not enough free for a second
    assert worker.lease_simulation(2, 8.0, lambda: 20.0) is not None


def test_a_crashed_slot_is_released_by_the_job_state():
    api, worker = make_stores()
    _enqueue(api, "a", 2)
    job = worker.lease_simulation(1, 0, None)
    worker.redis.hset(job_key(job.job_id), "status", "error")   # ended without releasing
    assert worker.lease_simulation(1, 0, None) is not None
    assert list(worker.redis.hgetall(SIM_ACTIVE_KEY)) != [job.job_id]


def test_position_cancel_and_reaper_use_the_workspace_list():
    api, worker = make_stores()
    a = _enqueue(api, "a", 2)
    _enqueue(api, "b", 1)

    async def body():
        view = await api.get(a[1])
        assert (view.position, view.total) == (3, 3)
        assert await api.cancel(a[1])
        assert await api.redis.lrange("simq:a", 0, -1) == [a[0]]
        depths = await api.pool_depths()
        assert depths["sim"] == 2 and depths["sim_running"] == 0

    run(body())
    job = worker.lease_simulation(2, 0, None)
    worker.redis.hset(job_key(job.job_id), "heartbeat", str(time.time() - 10_000))

    async def reap():
        assert await api.reap_once() == 1
        assert (await api.get(job.job_id)).status == "queued"
        assert job.job_id in await api.redis.lrange("simq:" + job.session_id, 0, -1)
        assert job.job_id not in await api.redis.hgetall(SIM_ACTIVE_KEY)

    run(reap())


def test_light_jobs_never_enter_the_simulation_lists():
    api, worker = make_stores()

    async def body():
        await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "a", {"variant": "pyroomacoustics_preflight"})
        await api.enqueue(JOB_TYPE_SED, "a", {"variant": "sed"})
        assert await api.redis.llen(QUEUE_CPU_LIGHT) == 2
        assert await api.redis.exists("simq:a") == 0

    run(body())
    assert worker.lease_simulation(2, 0, None) is None
    assert worker.lease([QUEUE_CPU_LIGHT], timeout=1) is not None
