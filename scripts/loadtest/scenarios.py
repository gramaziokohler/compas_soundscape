"""What a virtual user does: page load, heartbeat, browsing, saves, jobs."""

from __future__ import annotations

import asyncio
import json
import random
import re
import time

from client import VirtualUser
from config import (
    BROWSE_PAUSE_RANGE_S,
    GPU_QUEUE_PER_SESSION_MAX,
    JOB_POLL_INTERVAL_S,
    LLM_STREAM_TIMEOUT_S,
    MAX_STATIC_ASSETS,
    PRESENCE_INTERVAL_S,
    PYROOM_TIMEOUT_S,
    SOUND_TIMEOUT_S,
    SOUNDSCAPE_SAVE_INTERVAL_S,
    THROTTLED_STATUS,
)
from metrics import JobSample
from payloads import (
    BROWSE_GETS,
    LIBRARY_QUERIES,
    library_search_payload,
    llm_prompt_payload,
    pyroom_box_payload,
    soundscape_model_id,
    soundscape_save_payload,
    sound_generation_payload,
)

_STATIC_ASSET = re.compile(r"""(?:src|href)=["'](/_next/static/[^"']+)["']""")
_BOOTSTRAP_GETS = ("/api/workspaces", "/api/me/preferences", "/api/versions", "/api/tokens", "/api/jobs")
_TERMINAL_JOB_STATES = {"completed", "error", "cancelled"}


# ─── 1. Page load ────────────────────────────────────────────────────────────
async def open_page(vu: VirtualUser) -> None:
    """GET / + its JS/CSS chunks, then the frontend's bootstrap API burst."""
    html = await vu.get("/", name="GET / (html)")
    if html is not None and html.status_code == 200:
        assets = list(dict.fromkeys(_STATIC_ASSET.findall(html.text)))[:MAX_STATIC_ASSETS]
        await asyncio.gather(*(vu.get(a) for a in assets))

    me = await vu.get("/api/me")
    if me is not None and me.status_code == 200:
        data = me.json()
        vu.workspace_id = data.get("workspace_id")
        vu.email = data.get("email")
        vu.metrics.user_identities[vu.user_id] = data
    await asyncio.gather(*(vu.get(p) for p in _BOOTSTRAP_GETS))


# ─── 2. Presence heartbeat ───────────────────────────────────────────────────
async def presence_loop(vu: VirtualUser, stop_at: float) -> None:
    while time.time() < stop_at and vu.workspace_id:
        await vu.post(f"/api/workspaces/{vu.workspace_id}/presence")
        await asyncio.sleep(PRESENCE_INTERVAL_S)


# ─── 3. Browsing ─────────────────────────────────────────────────────────────
async def browse_loop(vu: VirtualUser, stop_at: float) -> None:
    while time.time() < stop_at:
        if random.random() < 0.2:
            await vu.post("/api/library/search", json=library_search_payload(random.choice(LIBRARY_QUERIES)))
        else:
            await vu.get(random.choice(BROWSE_GETS))
        await asyncio.sleep(random.uniform(*BROWSE_PAUSE_RANGE_S))


# ─── 4. Soundscape save / load round-trip ────────────────────────────────────
async def soundscape_loop(vu: VirtualUser, stop_at: float) -> None:
    model_id = soundscape_model_id(vu.user_id)
    revision: int | None = None
    iteration = 0
    while time.time() < stop_at:
        iteration += 1
        saved = await vu.post("/api/speckle/soundscape/save",
                              json=soundscape_save_payload(vu.user_id, iteration, revision))
        if saved is not None and saved.status_code == 200:
            revision = saved.json().get("revision", revision)
        elif saved is not None and saved.status_code == 409:
            revision = None  # stale — next save re-syncs from the load below
        loaded = await vu.get(f"/api/speckle/soundscape/{model_id}")
        if loaded is not None and loaded.status_code == 200 and revision is None:
            revision = loaded.json().get("revision")
        await asyncio.sleep(SOUNDSCAPE_SAVE_INTERVAL_S + random.uniform(0, 3))


# ─── 5. Jobs ─────────────────────────────────────────────────────────────────
async def _enqueue(vu: VirtualUser, job: JobSample, path: str, payload: dict) -> bool:
    resp = await vu.post(path, json=payload)
    if resp is None or resp.status_code != 200:
        job.status = "throttled" if resp is not None and resp.status_code == THROTTLED_STATUS else "enqueue_error"
        job.error = "transport error" if resp is None else f"HTTP {resp.status_code}: {resp.text[:160]}"
        job.done_at = time.time()
        return False
    job.job_id = resp.json().get("job_id", "")
    return True


async def _poll(vu: VirtualUser, job: JobSample, timeout_s: float) -> None:
    deadline = job.started_at + timeout_s
    while time.time() < deadline:
        resp = await vu.get(f"/api/jobs/{job.job_id}")
        if resp is not None and resp.status_code == 200:
            data = resp.json()
            if job.first_progress_at is None and ((data.get("progress") or 0) > 0 or data.get("partial")):
                job.first_progress_at = time.time()
            if data.get("status") in _TERMINAL_JOB_STATES:
                job.status = data["status"]
                job.error = data.get("error")
                job.done_at = time.time()
                return
        elif resp is not None and resp.status_code == 404:
            job.status, job.error, job.done_at = "error", "job not found / expired", time.time()
            return
        await asyncio.sleep(JOB_POLL_INTERVAL_S)
    job.status = "timeout"


async def run_pyroom_job(vu: VirtualUser) -> None:
    job = vu.metrics.add_job(JobSample("pyroom", vu.user_id))
    if await _enqueue(vu, job, "/api/pyroomacoustics/run-simulation-geometry", pyroom_box_payload(vu.index)):
        await _poll(vu, job, PYROOM_TIMEOUT_S)


async def run_sound_jobs(vu: VirtualUser, count: int) -> None:
    """Up to GPU_QUEUE_PER_SESSION_MAX concurrent generations for this user."""
    async def one() -> None:
        job = vu.metrics.add_job(JobSample("sound", vu.user_id))
        if await _enqueue(vu, job, "/api/generate-sounds", sound_generation_payload(vu.index, vu.cfg.audio_model)):
            await _poll(vu, job, SOUND_TIMEOUT_S)

    await asyncio.gather(*(one() for _ in range(min(count, GPU_QUEUE_PER_SESSION_MAX))))


async def run_llm_stream(vu: VirtualUser) -> None:
    job = vu.metrics.add_job(JobSample("llm", vu.user_id, job_id="sse"))
    try:
        async with asyncio.timeout(LLM_STREAM_TIMEOUT_S):
            async with vu.stream("POST", "/api/generate-prompts-stream", json=llm_prompt_payload(vu.index)) as resp:
                if resp.status_code != 200:
                    job.status, job.error = "error", f"HTTP {resp.status_code}"
                    job.done_at = time.time()
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    body = line[5:].strip()
                    if job.first_progress_at is None:
                        job.first_progress_at = time.time()
                    if body == "[DONE]":
                        job.status, job.done_at = "completed", time.time()
                        return
                    if '"error"' in body:
                        try:
                            if json.loads(body).get("type") == "error":
                                job.error = body[:200]
                        except ValueError:
                            pass
        job.status = "error"
        job.error = job.error or "stream ended without [DONE]"
        job.done_at = time.time()
    except TimeoutError:
        job.status = "timeout"
    except Exception as exc:  # noqa: BLE001 - transport errors are results, not crashes
        job.status, job.error, job.done_at = "error", f"{type(exc).__name__}: {exc}", time.time()
