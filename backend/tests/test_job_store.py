"""
Unit tests for services/job_store.py using fakeredis (no real Redis needed).

Run: pytest backend/tests/test_job_store.py
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import fakeredis
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from services.job_store import (  # noqa: E402
    AsyncJobStore,
    WorkerJobStore,
    JobNotFoundError,
    GpuQueueFullError,
    job_key,
)
from config.constants import (  # noqa: E402
    JOB_TYPE_SOUND,
    JOB_TYPE_PYROOMACOUSTICS,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_COMPLETED,
    JOB_STATUS_CANCELLED,
    GPU_QUEUE_PER_SESSION_MAX,
    JOB_MAX_ATTEMPTS,
)


def make_stores():
    """Return (AsyncJobStore, WorkerJobStore) sharing one in-memory fake server."""
    server = fakeredis.FakeServer()
    async_client = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    sync_client = fakeredis.FakeRedis(server=server, decode_responses=True)
    api_store = AsyncJobStore(client=async_client)
    worker_store = WorkerJobStore(client=sync_client)
    return api_store, worker_store


def run(coro):
    return asyncio.run(coro)


def test_enqueue_and_get_queued_position():
    api, _ = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "session-a", {"foo": "bar"})
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_QUEUED
        assert view.position == 1
        assert view.total == 1
        assert view.type == JOB_TYPE_PYROOMACOUSTICS

    run(body())


def test_get_unknown_job_raises():
    api, _ = make_stores()

    async def body():
        with pytest.raises(JobNotFoundError):
            await api.get("does-not-exist")

    run(body())


def test_lease_progress_complete_roundtrip():
    api, worker = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "session-a", {"x": 1})

        job = worker.lease(["queue:cpu"], timeout=1)
        assert job is not None
        assert job.job_id == job_id
        assert job.payload == {"x": 1}
        assert job.attempts == 1

        running_view = await api.get(job_id)
        assert running_view.status == JOB_STATUS_RUNNING
        assert running_view.position is None

        worker.set_progress(job_id, 42, "Halfway there", partial={"clips": 1})
        mid_view = await api.get(job_id)
        assert mid_view.progress == 42
        assert mid_view.status_text == "Halfway there"
        assert mid_view.partial == {"clips": 1}

        worker.complete(job_id, {"rir": "ok"})
        done_view = await api.get(job_id)
        assert done_view.status == JOB_STATUS_COMPLETED
        assert done_view.progress == 100
        assert done_view.result == {"rir": "ok"}

    run(body())


def test_fail_sets_error_status():
    api, worker = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "session-a", {})
        worker.lease(["queue:cpu"], timeout=1)
        worker.fail(job_id, "boom")
        view = await api.get(job_id)
        assert view.status == "error"
        assert view.error == "boom"

    run(body())


def test_cancel_queued_job_removes_from_list():
    api, worker = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "session-a", {})
        cancelled = await api.cancel(job_id)
        assert cancelled is True
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_CANCELLED

        # Queue must be empty — a lease should time out immediately.
        assert worker.lease(["queue:cpu"], timeout=1) is None

    run(body())


def test_cancel_running_job_sets_flag_and_publishes():
    api, worker = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "session-a", {})
        worker.lease(["queue:cpu"], timeout=1)

        pubsub = worker.redis.pubsub()
        pubsub.subscribe("job:cancel")
        pubsub.get_message(timeout=1)  # consume the "subscribe" confirmation

        cancelled = await api.cancel(job_id)
        assert cancelled is True
        assert worker.is_cancel_requested(job_id) is True

        msg = pubsub.get_message(timeout=1)
        assert msg is not None
        assert msg["data"] == job_id

        worker.mark_cancelled(job_id)
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_CANCELLED

    run(body())


def test_requeue_tail_for_clip_level_yielding():
    api, worker = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_SOUND, "session-a", {"clips": [1, 2, 3]})
        job = worker.lease(["queue:gpu"], timeout=1)
        assert job is not None

        worker.requeue_tail(job_id, {"clips": [2, 3]})
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_QUEUED
        assert view.position == 1

        job2 = worker.lease(["queue:gpu"], timeout=1)
        assert job2 is not None
        assert job2.job_id == job_id
        assert job2.payload == {"clips": [2, 3]}
        assert job2.attempts == 2

    run(body())


def test_per_session_gpu_cap_enforced():
    api, _ = make_stores()

    async def body():
        for _ in range(GPU_QUEUE_PER_SESSION_MAX):
            await api.enqueue(JOB_TYPE_SOUND, "session-cap", {})
        with pytest.raises(GpuQueueFullError):
            await api.enqueue(JOB_TYPE_SOUND, "session-cap", {})

        # A different session is unaffected.
        job_id = await api.enqueue(JOB_TYPE_SOUND, "session-other", {})
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_QUEUED

    run(body())


def test_pool_depths():
    api, _ = make_stores()

    async def body():
        await api.enqueue(JOB_TYPE_SOUND, "s1", {})
        await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "s1", {})
        await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "s1", {})
        depths = await api.pool_depths()
        assert depths == {"gpu": 1, "cpu": 2, "choras": 0}

    run(body())


def test_reaper_requeues_stale_running_job_then_fails_after_max_attempts():
    api, worker = make_stores()

    async def body():
        job_id = await api.enqueue(JOB_TYPE_PYROOMACOUSTICS, "session-a", {})
        worker.lease(["queue:cpu"], timeout=1)

        # Simulate a dead worker: heartbeat far in the past.
        stale = time.time() - 10_000
        await api.redis.hset(job_key(job_id), "heartbeat", str(stale))

        acted = await api.reap_once()
        assert acted == 1
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_QUEUED

        # Lease again, bump attempts up to the max, then let it go stale again.
        worker.lease(["queue:cpu"], timeout=1)
        await api.redis.hset(job_key(job_id), "attempts", str(JOB_MAX_ATTEMPTS))
        await api.redis.hset(job_key(job_id), "heartbeat", str(stale))

        acted2 = await api.reap_once()
        assert acted2 == 1
        final_view = await api.get(job_id)
        assert final_view.status == "error"

    run(body())


def test_io_job_lifecycle_no_queue():
    api, _ = make_stores()

    async def body():
        job_id = await api.enqueue_io("llm", "session-a")
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_QUEUED
        assert view.position is None
        assert view.total is None

        await api.set_progress(job_id, 40, "Generating...")
        mid_view = await api.get(job_id)
        assert mid_view.status == JOB_STATUS_RUNNING
        assert mid_view.progress == 40

        await api.complete(job_id, {"text": "done"})
        done_view = await api.get(job_id)
        assert done_view.status == JOB_STATUS_COMPLETED
        assert done_view.result == {"text": "done"}

    run(body())


def test_io_job_reap_once_never_touches_io_jobs():
    api, _ = make_stores()

    async def body():
        job_id = await api.enqueue_io("llm", "session-a")
        await api.set_progress(job_id, 10, "Working...")
        stale = time.time() - 10_000
        await api.redis.hset(job_key(job_id), "heartbeat", str(stale))

        acted = await api.reap_once()
        assert acted == 0  # IO jobs have no queue key — reaper must skip them
        view = await api.get(job_id)
        assert view.status == JOB_STATUS_RUNNING

    run(body())


def test_sweep_orphaned_io_jobs_marks_running_as_error():
    api, _ = make_stores()

    async def body():
        job_id = await api.enqueue_io("llm", "session-a")
        await api.set_progress(job_id, 10, "Working...")

        acted = await api.sweep_orphaned_io_jobs(("llm", "model_analysis", "tts"), "Server restarted")
        assert acted == 1
        view = await api.get(job_id)
        assert view.status == "error"
        assert view.error == "Server restarted"

    run(body())
