"""
Redis-backed unified job store.

Replaces the former in-memory `services/task_queue.py` (removed once every
router/worker had been switched over to this Redis-backed store).

Design (see .cursor/plans/multi-user_distributed_backend_a4752c5d.plan.md §4.1):

- Keys: `job:{id}` hash (type, session_id, status, progress, status_text,
  partial, result, error, worker_id, heartbeat, attempts, created, payload,
  cancel_requested); lists `queue:gpu` / `queue:cpu` / `queue:choras`;
  set `session:{sid}:pending_gpu` (GPU fairness cap); pub/sub channel
  `job:cancel`.
- `AsyncJobStore` (redis.asyncio) is used by the API process: enqueue, get,
  cancel, pool_depths, and the reaper.
- `WorkerJobStore` (sync redis) is used by worker processes: lease,
  heartbeat, set_progress, complete, fail, requeue_tail, cancel polling.
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import redis as redis_sync
import redis.asyncio as redis_async

from config.constants import (
    REDIS_URL,
    JOB_TYPE_QUEUE,
    JOB_TYPE_SOUND,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_COMPLETED,
    JOB_STATUS_CANCELLED,
    JOB_STATUS_ERROR,
    JOB_CANCEL_CHANNEL,
    JOB_HEARTBEAT_TIMEOUT_S,
    JOB_RESULT_TTL_S,
    JOB_MAX_ATTEMPTS,
    GPU_QUEUE_PER_SESSION_MAX,
)


class JobNotFoundError(Exception):
    """Raised when a job_id has no corresponding Redis hash."""


class GpuQueueFullError(Exception):
    """Raised when a session already has GPU_QUEUE_PER_SESSION_MAX jobs pending."""


def job_key(job_id: str) -> str:
    return f"job:{job_id}"


def pending_gpu_key(session_id: str) -> str:
    return f"session:{session_id}:pending_gpu"


@dataclass
class Job:
    """View returned by WorkerJobStore.lease() — a job ready to run."""
    job_id: str
    type: str
    session_id: str
    payload: dict
    attempts: int


@dataclass
class JobView:
    """View returned by AsyncJobStore.get() — full job state for polling."""
    job_id: str
    type: str
    session_id: str
    status: str
    progress: int
    status_text: str
    partial: Optional[Any]
    result: Optional[Any]
    error: Optional[str]
    worker_id: Optional[str]
    created: float
    position: Optional[int]   # 1-based queue position, None if not queued
    total: Optional[int]      # queue depth for this job's queue


def _parse_json_field(raw: str) -> Optional[Any]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _queue_key_for_type(job_type: str) -> Optional[str]:
    """Return the Redis list key for a queued (GPU/CPU/Choras) job type, or
    None for IO job types (llm/model_analysis/tts) which run immediately as
    asyncio tasks in the API process and never sit in a BLPOP list."""
    return JOB_TYPE_QUEUE.get(job_type)


# ─── API-side store (async) ────────────────────────────────────────────────────

class AsyncJobStore:
    """Used by the FastAPI process — enqueue/poll/cancel jobs."""

    def __init__(self, url: str = REDIS_URL, client: Any = None):
        self.redis = client if client is not None else redis_async.from_url(url, decode_responses=True)

    async def enqueue(self, job_type: str, session_id: Optional[str], payload: dict) -> str:
        """Create a job hash, push it onto its queue, return the job_id."""
        queue_key = _queue_key_for_type(job_type)
        if queue_key is None:
            raise ValueError(f"Job type {job_type!r} has no queue — use enqueue_io() instead")

        if job_type == JOB_TYPE_SOUND and session_id:
            pending_count = await self.redis.scard(pending_gpu_key(session_id))
            if pending_count >= GPU_QUEUE_PER_SESSION_MAX:
                raise GpuQueueFullError(
                    f"Session already has {pending_count} pending GPU jobs "
                    f"(max {GPU_QUEUE_PER_SESSION_MAX})"
                )

        job_id = uuid.uuid4().hex
        now = time.time()
        mapping = {
            "type": job_type,
            "session_id": session_id or "",
            "status": JOB_STATUS_QUEUED,
            "progress": "0",
            "status_text": "Queued",
            "partial": "",
            "result": "",
            "error": "",
            "worker_id": "",
            "heartbeat": str(now),
            "attempts": "0",
            "created": str(now),
            "payload": json.dumps(payload),
            "cancel_requested": "0",
        }

        pipe = self.redis.pipeline()
        pipe.hset(job_key(job_id), mapping=mapping)
        pipe.rpush(queue_key, job_id)
        if job_type == JOB_TYPE_SOUND and session_id:
            pipe.sadd(pending_gpu_key(session_id), job_id)
        await pipe.execute()
        return job_id

    async def get(self, job_id: str) -> JobView:
        data = await self.redis.hgetall(job_key(job_id))
        if not data:
            raise JobNotFoundError(job_id)

        status = data.get("status", JOB_STATUS_QUEUED)
        job_type = data.get("type", "")

        position: Optional[int] = None
        total: Optional[int] = None
        if status == JOB_STATUS_QUEUED:
            queue_key = _queue_key_for_type(job_type)
            if queue_key is not None:
                pos = await self.redis.lpos(queue_key, job_id)
                total = await self.redis.llen(queue_key)
                position = (pos + 1) if pos is not None else None

        return JobView(
            job_id=job_id,
            type=job_type,
            session_id=data.get("session_id", ""),
            status=status,
            progress=int(data.get("progress") or 0),
            status_text=data.get("status_text", ""),
            partial=_parse_json_field(data.get("partial", "")),
            result=_parse_json_field(data.get("result", "")),
            error=data.get("error") or None,
            worker_id=data.get("worker_id") or None,
            created=float(data.get("created") or 0.0),
            position=position,
            total=total,
        )

    async def cancel(self, job_id: str) -> bool:
        """Cancel a queued job immediately, or signal a running job to stop.

        Returns False if the job doesn't exist or is already finished.
        """
        key = job_key(job_id)
        data = await self.redis.hgetall(key)
        if not data:
            raise JobNotFoundError(job_id)

        status = data.get("status", JOB_STATUS_QUEUED)
        job_type = data.get("type", "")
        session_id = data.get("session_id", "")

        if status == JOB_STATUS_QUEUED:
            queue_key = _queue_key_for_type(job_type)
            pipe = self.redis.pipeline()
            if queue_key is not None:
                pipe.lrem(queue_key, 1, job_id)
            pipe.hset(key, mapping={"status": JOB_STATUS_CANCELLED, "status_text": "Cancelled"})
            pipe.expire(key, JOB_RESULT_TTL_S)
            if job_type == JOB_TYPE_SOUND and session_id:
                pipe.srem(pending_gpu_key(session_id), job_id)
            await pipe.execute()
            return True

        if status == JOB_STATUS_RUNNING:
            await self.redis.hset(key, "cancel_requested", "1")
            await self.redis.publish(JOB_CANCEL_CHANNEL, job_id)
            return True

        return False

    async def pool_depths(self) -> dict:
        depths = {}
        for role, queue_key in {"gpu": "queue:gpu", "cpu": "queue:cpu", "choras": "queue:choras"}.items():
            depths[role] = await self.redis.llen(queue_key)
        return depths

    async def reap_once(self) -> int:
        """Re-queue or fail running jobs whose worker heartbeat went stale.

        Returns the number of jobs acted on. Intended to be called on a
        periodic asyncio task from the API lifespan.
        """
        acted = 0
        now = time.time()
        async for key in self.redis.scan_iter(match="job:*"):
            data = await self.redis.hgetall(key)
            if not data or data.get("status") != JOB_STATUS_RUNNING:
                continue
            heartbeat = float(data.get("heartbeat") or 0.0)
            if now - heartbeat < JOB_HEARTBEAT_TIMEOUT_S:
                continue

            job_id = key.split(":", 1)[1]
            job_type = data.get("type", "")
            session_id = data.get("session_id", "")
            attempts = int(data.get("attempts") or 0)

            queue_key = _queue_key_for_type(job_type)
            if queue_key is None:
                # IO job types (llm/model_analysis/tts) run in-process with no
                # queue to requeue onto — a dead API process is handled by
                # sweep_orphaned_io_jobs() at the next startup instead.
                continue

            if attempts < JOB_MAX_ATTEMPTS:
                pipe = self.redis.pipeline()
                pipe.hset(key, mapping={
                    "status": JOB_STATUS_QUEUED,
                    "status_text": "Requeued after worker timeout",
                    "worker_id": "",
                })
                pipe.rpush(queue_key, job_id)
                await pipe.execute()
            else:
                pipe = self.redis.pipeline()
                pipe.hset(key, mapping={
                    "status": JOB_STATUS_ERROR,
                    "status_text": "Worker timeout",
                    "error": "Worker heartbeat timed out after max attempts",
                })
                pipe.expire(key, JOB_RESULT_TTL_S)
                if job_type == JOB_TYPE_SOUND and session_id:
                    pipe.srem(pending_gpu_key(session_id), job_id)
                await pipe.execute()
            acted += 1
        return acted

    async def enqueue_io(self, job_type: str, session_id: Optional[str]) -> str:
        """Create a job hash for an IO job type (llm/model_analysis/tts) with
        no queue push — the caller runs it immediately as an asyncio task
        (see services/io_jobs.py) and reports progress via set_progress().
        """
        job_id = uuid.uuid4().hex
        now = time.time()
        mapping = {
            "type": job_type,
            "session_id": session_id or "",
            "status": JOB_STATUS_QUEUED,
            "progress": "0",
            "status_text": "Queued",
            "partial": "",
            "result": "",
            "error": "",
            "worker_id": "",
            "heartbeat": str(now),
            "attempts": "0",
            "created": str(now),
            "payload": "",
            "cancel_requested": "0",
        }
        await self.redis.hset(job_key(job_id), mapping=mapping)
        return job_id

    async def set_progress(self, job_id: str, value: int, text: str, partial: Optional[Any] = None) -> None:
        """Update progress/status_text for an IO job and mark it running
        (IO jobs never go through lease(), so nothing else sets status)."""
        mapping = {"status": JOB_STATUS_RUNNING, "progress": str(value), "status_text": text, "heartbeat": str(time.time())}
        if partial is not None:
            mapping["partial"] = json.dumps(partial)
        await self.redis.hset(job_key(job_id), mapping=mapping)

    async def heartbeat(self, job_id: str) -> None:
        await self.redis.hset(job_key(job_id), "heartbeat", str(time.time()))

    async def complete(self, job_id: str, result: Any) -> None:
        key = job_key(job_id)
        await self.redis.hset(key, mapping={
            "status": JOB_STATUS_COMPLETED,
            "progress": "100",
            "status_text": "Completed",
            "result": json.dumps(result),
        })
        await self.redis.expire(key, JOB_RESULT_TTL_S)

    async def fail(self, job_id: str, err: str) -> None:
        key = job_key(job_id)
        await self.redis.hset(key, mapping={
            "status": JOB_STATUS_ERROR,
            "status_text": "Error",
            "error": err,
        })
        await self.redis.expire(key, JOB_RESULT_TTL_S)

    async def sweep_orphaned_io_jobs(self, job_types: tuple, message: str) -> int:
        """Called once at API startup: any IO job left status=running belonged
        to the previous process and died with it (in-process asyncio tasks
        don't survive a restart, unlike queued jobs leased by workers)."""
        acted = 0
        async for key in self.redis.scan_iter(match="job:*"):
            data = await self.redis.hgetall(key)
            if not data or data.get("type") not in job_types:
                continue
            if data.get("status") != JOB_STATUS_RUNNING:
                continue
            await self.redis.hset(key, mapping={
                "status": JOB_STATUS_ERROR,
                "status_text": "Error",
                "error": message,
            })
            await self.redis.expire(key, JOB_RESULT_TTL_S)
            acted += 1
        return acted

    async def close(self) -> None:
        await self.redis.aclose()


# ─── Worker-side store (sync) ──────────────────────────────────────────────────

class WorkerJobStore:
    """Used by worker processes — lease/heartbeat/progress/complete/fail."""

    def __init__(self, url: str = REDIS_URL, client: Any = None):
        self.redis = client if client is not None else redis_sync.from_url(url, decode_responses=True)

    def lease(self, queue_keys: list[str], timeout: int = 5) -> Optional[Job]:
        """Block on the given queues (in priority order) for up to `timeout`s.

        Returns None when nothing was leased. On Windows + some Redis builds,
        redis-py raises ``TimeoutError`` from a timed-out ``BLPOP`` instead of
        returning ``None`` — treat that (and transient connection errors) as an
        empty poll so the worker loop keeps going instead of dying.
        """
        try:
            popped = self.redis.blpop(queue_keys, timeout=timeout)
        except redis_sync.exceptions.TimeoutError:
            return None
        except (redis_sync.exceptions.ConnectionError, OSError):
            # Redis down or the pooled socket died mid-read — drop every pooled
            # connection so the next lease starts clean, then back off briefly.
            try:
                self.redis.connection_pool.disconnect()
            except Exception:
                pass
            time.sleep(2)
            return None
        if popped is None:
            return None
        _queue_key, job_id = popped

        key = job_key(job_id)
        now = time.time()
        attempts = self.redis.hincrby(key, "attempts", 1)
        self.redis.hset(key, mapping={
            "status": JOB_STATUS_RUNNING,
            "status_text": "Starting...",
            "heartbeat": str(now),
        })
        data = self.redis.hgetall(key)
        payload = _parse_json_field(data.get("payload", "")) or {}
        return Job(
            job_id=job_id,
            type=data.get("type", ""),
            session_id=data.get("session_id", ""),
            payload=payload,
            attempts=attempts,
        )

    def heartbeat(self, job_id: str, worker_id: Optional[str] = None) -> None:
        mapping = {"heartbeat": str(time.time())}
        if worker_id is not None:
            mapping["worker_id"] = worker_id
        self.redis.hset(job_key(job_id), mapping=mapping)

    def set_progress(
        self,
        job_id: str,
        value: int,
        text: str,
        partial: Optional[Any] = None,
    ) -> None:
        mapping = {"progress": str(value), "status_text": text}
        if partial is not None:
            mapping["partial"] = json.dumps(partial)
        self.redis.hset(job_key(job_id), mapping=mapping)

    def complete(self, job_id: str, result: Any) -> None:
        key = job_key(job_id)
        data = self.redis.hgetall(key)
        job_type = data.get("type", "")
        session_id = data.get("session_id", "")

        pipe = self.redis.pipeline()
        pipe.hset(key, mapping={
            "status": JOB_STATUS_COMPLETED,
            "progress": "100",
            "status_text": "Completed",
            "result": json.dumps(result),
        })
        pipe.expire(key, JOB_RESULT_TTL_S)
        if job_type == JOB_TYPE_SOUND and session_id:
            pipe.srem(pending_gpu_key(session_id), job_id)
        pipe.execute()

    def fail(self, job_id: str, err: str) -> None:
        key = job_key(job_id)
        data = self.redis.hgetall(key)
        job_type = data.get("type", "")
        session_id = data.get("session_id", "")

        pipe = self.redis.pipeline()
        pipe.hset(key, mapping={
            "status": JOB_STATUS_ERROR,
            "status_text": "Error",
            "error": err,
        })
        pipe.expire(key, JOB_RESULT_TTL_S)
        if job_type == JOB_TYPE_SOUND and session_id:
            pipe.srem(pending_gpu_key(session_id), job_id)
        pipe.execute()

    def mark_cancelled(self, job_id: str) -> None:
        """Called by a worker once it has actually stopped a running job."""
        key = job_key(job_id)
        data = self.redis.hgetall(key)
        job_type = data.get("type", "")
        session_id = data.get("session_id", "")

        pipe = self.redis.pipeline()
        pipe.hset(key, mapping={"status": JOB_STATUS_CANCELLED, "status_text": "Cancelled"})
        pipe.expire(key, JOB_RESULT_TTL_S)
        if job_type == JOB_TYPE_SOUND and session_id:
            pipe.srem(pending_gpu_key(session_id), job_id)
        pipe.execute()

    def is_cancel_requested(self, job_id: str) -> bool:
        return self.redis.hget(job_key(job_id), "cancel_requested") == "1"

    def requeue_tail(self, job_id: str, payload: dict) -> None:
        """Push the (updated) job back onto the tail of its queue.

        Used for clip-level yielding (a multi-clip GPU job re-queues its
        remainder under the same job_id) and by the reaper.
        """
        key = job_key(job_id)
        data = self.redis.hgetall(key)
        job_type = data.get("type", "")
        queue_key = _queue_key_for_type(job_type)

        pipe = self.redis.pipeline()
        pipe.hset(key, mapping={
            "status": JOB_STATUS_QUEUED,
            "status_text": "Queued",
            "payload": json.dumps(payload),
            "worker_id": "",
            "cancel_requested": "0",
        })
        pipe.rpush(queue_key, job_id)
        pipe.execute()

    def close(self) -> None:
        self.redis.close()


# ─── Module-level singleton (API process) ──────────────────────────────────────

job_store = AsyncJobStore()
