"""
Concurrent multi-user load test for COMPAS Soundscape.

Simulates N virtual users, each with its own identity/workspace, opening the
page, heart-beating presence, browsing, saving/loading a soundscape and
running acoustic / text-to-audio / LLM jobs — all at the same time.

Usage (PowerShell, from repo root):
    $env:CF_ACCESS_CLIENT_ID="...";  $env:CF_ACCESS_CLIENT_SECRET="..."
    python scripts/loadtest/run.py                                  # 20 users vs soundisblue.com
    python scripts/loadtest/run.py --users 1 --duration 30 --sounds 0 --llm 0   # smoke test
    python scripts/loadtest/run.py --base-url http://localhost:8000 --users 3 --duration 60

See scripts/loadtest/README.md for the Cloudflare + server setup.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
import time

from checks import run_all_checks
from client import AccessDeniedError, VirtualUser
from config import (
    DEFAULT_BASE_URL,
    DEFAULT_DURATION_S,
    DEFAULT_LLM_STREAMS,
    DEFAULT_PYROOM_JOBS,
    DEFAULT_RAMP_S,
    DEFAULT_SOUND_JOBS,
    DEFAULT_USERS,
    QUEUE_SAMPLE_INTERVAL_S,
    RunConfig,
)
from metrics import Metrics
from report import print_report, write_results
from scenarios import (
    browse_loop,
    open_page,
    presence_loop,
    run_llm_stream,
    run_pyroom_job,
    run_sound_jobs,
    soundscape_loop,
)


def parse_args() -> RunConfig:
    p = argparse.ArgumentParser(description="COMPAS multi-user concurrent load test")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument("--users", type=int, default=DEFAULT_USERS)
    p.add_argument("--ramp", type=float, default=DEFAULT_RAMP_S, help="seconds over which users arrive")
    p.add_argument("--duration", type=float, default=DEFAULT_DURATION_S, help="seconds each user stays active")
    p.add_argument("--pyroom", type=int, default=DEFAULT_PYROOM_JOBS, help="total pyroomacoustics jobs")
    p.add_argument("--sounds", type=int, default=DEFAULT_SOUND_JOBS, help="total text-to-audio jobs")
    p.add_argument("--llm", type=int, default=DEFAULT_LLM_STREAMS, help="total LLM SSE streams")
    p.add_argument("--audio-model", default=None, help="e.g. tangoflux; default = server default model")
    p.add_argument("--insecure", action="store_true", help="skip TLS verification")
    a = p.parse_args()
    return RunConfig(a.base_url, a.users, a.ramp, a.duration, a.pyroom, a.sounds, a.llm,
                     a.audio_model, not a.insecure)


def distribute(total: int, users: int) -> list[int]:
    """Spread `total` jobs round-robin over `users` (user i gets counts[i])."""
    counts = [0] * users
    for i in range(total):
        counts[i % users] += 1
    return counts


async def _delayed(delay_s: float, coro) -> None:
    await asyncio.sleep(delay_s)
    await coro


async def user_session(vu: VirtualUser, cfg: RunConfig, arrive_s: float,
                       pyroom: int, sounds: int, llm: int) -> None:
    await asyncio.sleep(arrive_s)
    try:
        await open_page(vu)
        stop_at = time.time() + cfg.duration_s
        job_window = cfg.duration_s / 2  # start jobs in the first half so they can finish
        tasks = [presence_loop(vu, stop_at), browse_loop(vu, stop_at), soundscape_loop(vu, stop_at)]
        tasks += [_delayed(random.uniform(0, job_window), run_pyroom_job(vu)) for _ in range(pyroom)]
        if sounds:
            tasks.append(_delayed(random.uniform(0, job_window), run_sound_jobs(vu, sounds)))
        tasks += [_delayed(random.uniform(0, job_window), run_llm_stream(vu)) for _ in range(llm)]
        await asyncio.gather(*tasks)
    except AccessDeniedError as exc:
        print(f"[{vu.user_id}] {exc}")


async def queue_sampler(vu: VirtualUser, metrics: Metrics, done: asyncio.Event) -> None:
    while not done.is_set():
        resp = await vu.get("/api/queue/status", name="GET /api/queue/status (sampler)")
        if resp is not None and resp.status_code == 200:
            metrics.queue_samples.append((time.time(), resp.json()))
        try:
            await asyncio.wait_for(done.wait(), QUEUE_SAMPLE_INTERVAL_S)
        except asyncio.TimeoutError:
            pass


async def preflight(cfg: RunConfig, metrics: Metrics) -> bool:
    probe = VirtualUser(0, cfg, Metrics())
    try:
        resp = await probe.get("/api/me")
    except AccessDeniedError as exc:
        print(f"Preflight failed: {exc}")
        if cfg.has_service_token:
            print(f"  Service-token headers WERE sent (client id ends …{cfg.cf_client_id[-12:]}), so Cloudflare's edge "
                  "rejected them: check the policy action is 'Service Auth' (not 'Allow'), that it is attached to "
                  "the soundisblue.com application, and that the secret was copied correctly.")
        else:
            print("  No service-token headers were sent: set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET in this shell.")
        return False
    finally:
        await probe.close()
    if resp is None or resp.status_code != 200:
        print(f"Preflight failed: GET /api/me → {resp.status_code if resp is not None else 'transport error'}")
        return False
    print(f"Preflight OK: vu-01 resolves to {resp.json().get('email')}")
    return True


async def main_async(cfg: RunConfig) -> int:
    if not cfg.has_service_token and "localhost" not in cfg.base_url:
        print("Warning: CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET not set — Cloudflare Access will block requests.")
    metrics = Metrics()
    if not await preflight(cfg, metrics):
        return 2

    print(f"Starting {cfg.users} users over {cfg.ramp_s:.0f}s, {cfg.duration_s:.0f}s each "
          f"({cfg.pyroom_jobs} pyroom, {cfg.sound_jobs} sound, {cfg.llm_streams} LLM)…")
    users = [VirtualUser(i, cfg, metrics) for i in range(cfg.users)]
    pyroom = distribute(cfg.pyroom_jobs, cfg.users)
    sounds = distribute(cfg.sound_jobs, cfg.users)
    # Offset LLM users so they don't all land on the same users as the sound jobs.
    llm = distribute(cfg.llm_streams, cfg.users)[::-1]

    sampler_vu = VirtualUser(cfg.users, cfg, metrics)
    done = asyncio.Event()
    sampler = asyncio.create_task(queue_sampler(sampler_vu, metrics, done))
    try:
        await asyncio.gather(*(
            user_session(u, cfg, cfg.ramp_s * i / max(cfg.users - 1, 1), pyroom[i], sounds[i], llm[i])
            for i, u in enumerate(users)
        ))
        await run_all_checks(users, cfg, metrics)
    finally:
        done.set()
        await sampler
        await asyncio.gather(*(u.close() for u in users), sampler_vu.close())

    print_report(cfg, metrics)
    print(f"\nResults written to {write_results(cfg, metrics)}")
    failed = [c for c in metrics.checks if c.blocking and not c.passed]
    print("\nLOAD TEST PASSED" if not failed else f"\nLOAD TEST FAILED ({len(failed)} checks)")
    return 0 if not failed else 1


def main() -> None:
    try:
        sys.exit(asyncio.run(main_async(parse_args())))
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
