"""In-memory metric collection: HTTP timings, job lifecycles, queue depth, checks."""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RequestSample:
    name: str          # normalised endpoint, e.g. "GET /api/jobs/{id}"
    status: int        # 0 = transport error (timeout, connection reset, ...)
    latency_s: float
    error: Optional[str] = None


@dataclass
class JobSample:
    kind: str          # pyroom | sound | llm
    user_id: str
    job_id: str = ""
    started_at: float = field(default_factory=time.time)
    first_progress_at: Optional[float] = None   # sound/pyroom: progress>0; llm: first SSE event
    done_at: Optional[float] = None
    status: str = "pending"  # completed | error | cancelled | timeout | throttled | enqueue_error
    error: Optional[str] = None

    @property
    def total_s(self) -> Optional[float]:
        return self.done_at - self.started_at if self.done_at else None

    @property
    def first_progress_s(self) -> Optional[float]:
        return self.first_progress_at - self.started_at if self.first_progress_at else None


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str
    blocking: bool = True    # non-blocking checks are reported as WARN, not FAIL


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct / 100.0
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


class Metrics:
    """Shared, asyncio-only collector (single event loop → no locking needed)."""

    def __init__(self) -> None:
        self.started_at = time.time()
        self.requests: list[RequestSample] = []
        self.jobs: list[JobSample] = []
        self.queue_samples: list[tuple[float, dict]] = []
        self.checks: list[CheckResult] = []
        self.user_identities: dict[str, dict] = {}   # user_id → /api/me payload

    def record(self, sample: RequestSample) -> None:
        self.requests.append(sample)

    def add_job(self, job: JobSample) -> JobSample:
        self.jobs.append(job)
        return job

    def add_check(self, check: CheckResult) -> None:
        self.checks.append(check)

    # ─── Aggregates ──────────────────────────────────────────────────────
    def endpoint_stats(self) -> list[dict]:
        grouped: dict[str, list[RequestSample]] = defaultdict(list)
        for s in self.requests:
            grouped[s.name].append(s)
        rows = []
        for name, samples in sorted(grouped.items()):
            lat = [s.latency_s * 1000 for s in samples]
            codes: dict[str, int] = defaultdict(int)
            for s in samples:
                codes[str(s.status)] += 1
            errors = sum(1 for s in samples if s.status == 0 or s.status >= 500)
            rows.append({
                "endpoint": name,
                "count": len(samples),
                "errors": errors,
                "p50_ms": round(percentile(lat, 50)),
                "p95_ms": round(percentile(lat, 95)),
                "p99_ms": round(percentile(lat, 99)),
                "max_ms": round(max(lat)),
                "status_codes": dict(codes),
            })
        return rows

    def job_stats(self) -> list[dict]:
        grouped: dict[str, list[JobSample]] = defaultdict(list)
        for j in self.jobs:
            grouped[j.kind].append(j)
        rows = []
        for kind, jobs in sorted(grouped.items()):
            done = [j.total_s for j in jobs if j.status == "completed" and j.total_s is not None]
            first = [j.first_progress_s for j in jobs if j.first_progress_s is not None]
            statuses: dict[str, int] = defaultdict(int)
            for j in jobs:
                statuses[j.status] += 1
            rows.append({
                "kind": kind,
                "count": len(jobs),
                "statuses": dict(statuses),
                "first_progress_p50_s": round(percentile(first, 50), 1),
                "first_progress_max_s": round(max(first), 1) if first else 0.0,
                "total_p50_s": round(percentile(done, 50), 1),
                "total_p95_s": round(percentile(done, 95), 1),
                "total_max_s": round(max(done), 1) if done else 0.0,
            })
        return rows

    def server_errors(self) -> list[RequestSample]:
        return [s for s in self.requests if s.status == 0 or s.status >= 500]
