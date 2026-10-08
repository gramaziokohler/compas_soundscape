"""Post-run assertions: distinct sessions, isolation, errors, job completion."""

from __future__ import annotations

import asyncio
from collections import defaultdict

from client import VirtualUser
from config import RunConfig
from metrics import CheckResult, Metrics


def check_distinct_sessions(users: list[VirtualUser], metrics: Metrics) -> None:
    resolved = [u for u in users if u.workspace_id]
    workspaces = {u.workspace_id for u in resolved}
    metrics.add_check(CheckResult(
        "distinct workspaces",
        len(resolved) == len(users) and len(workspaces) == len(users),
        f"{len(resolved)}/{len(users)} users resolved /api/me, {len(workspaces)} distinct workspace ids",
    ))


def check_loadtest_identity(users: list[VirtualUser], cfg: RunConfig, metrics: Metrics) -> None:
    if not cfg.has_service_token:
        return
    anon = [u.user_id for u in users if u.email and not u.email.startswith("loadtest-")]
    metrics.add_check(CheckResult(
        "service-token identity",
        not anon,
        "all users resolved to loadtest-* identities" if not anon else
        f"{len(anon)} users fell back to another identity (is LOADTEST_SERVICE_TOKEN_IDS set on the server?): {anon[:5]}",
    ))


async def check_job_isolation(users: list[VirtualUser], metrics: Metrics) -> None:
    owned: dict[str, set[str]] = defaultdict(set)
    for job in metrics.jobs:
        if job.job_id and job.job_id != "sse":
            owned[job.user_id].add(job.job_id)
    if len(owned) < 2:
        metrics.add_check(CheckResult("job list isolation", True, "skipped — fewer than 2 users own jobs", blocking=False))
        return

    async def leaked_for(u: VirtualUser) -> set[str]:
        resp = await u.get("/api/jobs", name="GET /api/jobs (isolation check)")
        if resp is None or resp.status_code != 200:
            return set()
        visible = {j.get("job_id") for j in resp.json()}
        foreign = set().union(*(ids for uid, ids in owned.items() if uid != u.user_id))
        return visible & foreign

    leaks = await asyncio.gather(*(leaked_for(u) for u in users))
    total = sum(len(x) for x in leaks)
    metrics.add_check(CheckResult(
        "job list isolation", total == 0,
        "no user saw another user's jobs in GET /api/jobs" if total == 0 else f"{total} foreign job ids visible",
    ))

    # Direct fetch by id: the router does not scope GET /api/jobs/{id} by session.
    owners = [uid for uid in owned if owned[uid]]
    reader = next(u for u in users if u.user_id != owners[0])
    foreign_id = next(iter(owned[owners[0]]))
    resp = await reader.get(f"/api/jobs/{foreign_id}", name="GET /api/jobs/{id} (isolation check)")
    readable = resp is not None and resp.status_code == 200
    metrics.add_check(CheckResult(
        "job fetch-by-id isolation", not readable,
        f"{reader.user_id} reading {owners[0]}'s job by id → HTTP {resp.status_code if resp is not None else 'error'}"
        + (" (job ids are unguessable UUIDs, but the endpoint is not session-scoped)" if readable else ""),
        blocking=False,
    ))


def check_errors_and_jobs(metrics: Metrics) -> None:
    errors = metrics.server_errors()
    by_endpoint: dict[str, int] = defaultdict(int)
    for e in errors:
        by_endpoint[e.name] += 1
    metrics.add_check(CheckResult(
        "no 5xx / transport errors", not errors,
        "none" if not errors else ", ".join(f"{k} ×{v}" for k, v in sorted(by_endpoint.items(), key=lambda kv: -kv[1])[:6]),
    ))

    failed = [j for j in metrics.jobs if j.status not in ("completed", "throttled")]
    throttled = sum(1 for j in metrics.jobs if j.status == "throttled")
    metrics.add_check(CheckResult(
        "all jobs completed", not failed,
        f"{len(metrics.jobs) - len(failed) - throttled}/{len(metrics.jobs)} completed, {throttled} throttled (429)"
        + ("" if not failed else "; failed: " + ", ".join(f"{j.kind}/{j.user_id}={j.status}" for j in failed[:6])),
    ))


async def run_all_checks(users: list[VirtualUser], cfg: RunConfig, metrics: Metrics) -> None:
    check_distinct_sessions(users, metrics)
    check_loadtest_identity(users, cfg, metrics)
    await check_job_isolation(users, metrics)
    check_errors_and_jobs(metrics)
