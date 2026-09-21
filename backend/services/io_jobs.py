"""
In-process (asyncio) job execution for TTS, plus the LLM semaphore
shared by SSE agent streams.

TTS jobs get a Redis-visible job_id (uniform polling via GET /api/jobs/{id}
— see routers/jobs.py) and run as asyncio.create_task() in the API process,
gated by TTS_SEMAPHORE. SSE agent streams (scenarist/foley/speech/orchestrate/
analyze-3dmodel-stream) don't need a job_id — the stream itself is the
response — so they acquire LLM_SEMAPHORE directly and use
iter_with_keepalive() to inject ": ping\\n\\n" comments during any gap
longer than SSE_KEEPALIVE_INTERVAL_S (Cloudflare/nginx drop idle proxied
connections after ~100s).
"""
from __future__ import annotations

import asyncio
import traceback
from typing import Any, AsyncIterator, Awaitable, Callable, Optional, Tuple

from starlette.concurrency import run_in_threadpool

from services.job_store import job_store
from config.constants import (
    LLM_MAX_CONCURRENT,
    TTS_MAX_CONCURRENT,
    JOB_TYPE_TTS,
    IO_JOB_TYPES,
    SSE_KEEPALIVE_INTERVAL_S,
)
from utils.llm_errors import llm_error_message

# ── Concurrency pools ───────────────────────────────────────────────────────

LLM_SEMAPHORE = asyncio.Semaphore(LLM_MAX_CONCURRENT)
TTS_SEMAPHORE = asyncio.Semaphore(TTS_MAX_CONCURRENT)

_SEMAPHORES = {
    JOB_TYPE_TTS: TTS_SEMAPHORE,
}


async def start_io_job(
    job_type: str,
    session_id: Optional[str],
    coro_factory: Callable[[str], Awaitable[None]],
) -> str:
    """Create an IO job hash in Redis and immediately start it as a background
    asyncio task, gated by the pool's semaphore.

    `coro_factory(job_id)` owns the job end-to-end: it must call
    `job_store.complete(job_id, result)` on success. If it raises, this
    wrapper calls `job_store.fail(job_id, ...)` for it. Returns immediately —
    callers poll GET /api/jobs/{job_id} for progress/result.
    """
    job_id = await job_store.enqueue_io(job_type, session_id)
    sem = _SEMAPHORES.get(job_type, LLM_SEMAPHORE)

    async def _run() -> None:
        async with sem:
            try:
                await coro_factory(job_id)
            except Exception as exc:
                traceback.print_exc()
                await job_store.fail(job_id, llm_error_message(exc))

    asyncio.create_task(_run())
    return job_id


async def run_blocking(fn: Callable, *args: Any, **kwargs: Any) -> Any:
    """Run a synchronous (blocking) call off the event loop thread.

    Use for synchronous service methods so a single slow call can't stall
    every other request the API is serving.
    """
    return await run_in_threadpool(fn, *args, **kwargs)


async def iter_with_keepalive(
    aiterable, keepalive_s: int = SSE_KEEPALIVE_INTERVAL_S
) -> AsyncIterator[Tuple[str, Any]]:
    """Wrap an async iterable, yielding ("item", value) for each value and
    ("ping", None) whenever more than keepalive_s seconds pass without one.

    Used by SSE agent endpoints so a slow LLM turn doesn't leave the
    connection idle long enough for Cloudflare/nginx to close it.

    Keep a SINGLE in-flight ``__anext__`` task alive across keepalive
    timeouts. ``asyncio.wait_for(it.__anext__(), ...)`` would cancel the
    coroutine on every timeout, and cancelling a suspended async generator's
    ``__anext__`` throws CancelledError into it at its current ``await``,
    closing the generator — the next ``__anext__`` then raises
    StopAsyncIteration and the SSE stream ends silently after one interval.
    """
    it = aiterable.__aiter__()
    pending: asyncio.Future = asyncio.ensure_future(it.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=keepalive_s)
            if not done:
                yield ("ping", None)
                continue
            try:
                item = pending.result()
            except StopAsyncIteration:
                return
            yield ("item", item)
            pending = asyncio.ensure_future(it.__anext__())
    finally:
        pending.cancel()


async def sweep_orphaned_io_jobs() -> int:
    """Called once at API startup (main.py lifespan): any IO job left
    status=running belonged to the previous process and died with it —
    in-process asyncio tasks don't survive a restart the way queued jobs
    (leased by a separate worker process) do."""
    return await job_store.sweep_orphaned_io_jobs(
        IO_JOB_TYPES, "Server restarted while this job was running"
    )
