"""Console + JSON/CSV report output."""

from __future__ import annotations

import csv
import json
import time
from dataclasses import asdict
from pathlib import Path

from config import RESULTS_DIR_NAME, RunConfig
from metrics import Metrics


def _table(rows: list[dict], columns: list[str]) -> str:
    widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in rows)) for c in columns}
    line = "  ".join(c.ljust(widths[c]) for c in columns)
    out = [line, "-" * len(line)]
    out += ["  ".join(str(r.get(c, "")).ljust(widths[c]) for c in columns) for r in rows]
    return "\n".join(out)


def print_report(cfg: RunConfig, metrics: Metrics) -> None:
    elapsed = time.time() - metrics.started_at
    total = len(metrics.requests)
    print(f"\n=== Load test: {cfg.users} users → {cfg.base_url} ({elapsed:.0f}s, {total} requests, "
          f"{total / max(elapsed, 1):.1f} req/s) ===\n")

    endpoints = metrics.endpoint_stats()
    if endpoints:
        print(_table(endpoints, ["endpoint", "count", "errors", "p50_ms", "p95_ms", "p99_ms", "max_ms"]))
    jobs = metrics.job_stats()
    if jobs:
        print("\n" + _table(jobs, ["kind", "count", "statuses", "first_progress_p50_s",
                                   "total_p50_s", "total_p95_s", "total_max_s"]))
    if metrics.queue_samples:
        peaks: dict[str, int] = {}
        for _, depths in metrics.queue_samples:
            for queue, depth in depths.items():
                if isinstance(depth, int):
                    peaks[queue] = max(peaks.get(queue, 0), depth)
        print(f"\nPeak queue depths: {peaks}")

    print("\nChecks:")
    for c in metrics.checks:
        tag = "PASS" if c.passed else ("FAIL" if c.blocking else "WARN")
        print(f"  [{tag}] {c.name}: {c.detail}")


def write_results(cfg: RunConfig, metrics: Metrics) -> Path:
    out_dir = Path(__file__).resolve().parent / RESULTS_DIR_NAME
    out_dir.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    json_path = out_dir / f"{stamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "config": asdict(cfg),
            "endpoints": metrics.endpoint_stats(),
            "jobs": metrics.job_stats(),
            "job_details": [asdict(j) for j in metrics.jobs],
            "queue_samples": [{"t": round(t - metrics.started_at, 1), **d} for t, d in metrics.queue_samples],
            "checks": [asdict(c) for c in metrics.checks],
            "identities": metrics.user_identities,
        }, f, indent=2)

    with open(out_dir / f"{stamp}-requests.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["endpoint", "status", "latency_ms", "error"])
        for s in metrics.requests:
            writer.writerow([s.name, s.status, round(s.latency_s * 1000, 1), s.error or ""])
    return json_path
