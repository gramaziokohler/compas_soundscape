"""Gemini TTS rate limiting: RpmLimiter, 429 classification, generate_tts_item retries."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from services import tts_job  # noqa: E402
from services.rate_limiter import RpmLimiter  # noqa: E402
from utils.gemini_quota import classify_quota_error  # noqa: E402


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class ApiError(Exception):
    """Shaped like google.genai.errors.APIError: `.code` + details in str()."""

    def __init__(self, code: int, text: str) -> None:
        super().__init__(text)
        self.code = code


DAILY_429 = ApiError(429, "429 RESOURCE_EXHAUSTED. {'details': [{'quotaId': "
                          "'GenerateRequestsPerDayPerProjectPerModel', 'quotaValue': '100'}]}")
MINUTE_429 = ApiError(429, "429 RESOURCE_EXHAUSTED. {'details': [{'quotaId': "
                           "'GenerateRequestsPerMinutePerProjectPerModel'}, {'retryDelay': '23s'}]}")


# ── RpmLimiter ──────────────────────────────────────────────────────────────

def test_limiter_allows_rpm_then_waits_for_oldest_to_expire():
    clock = FakeClock()
    lim = RpmLimiter(3, window_s=60.0, clock=clock)
    for _ in range(3):
        asyncio.run(lim.acquire())
        clock.now += 5.0
    # 3 stamps at t=1000, 1005, 1010; now 1015 -> oldest frees at 1060.
    assert lim.wait_seconds() == pytest.approx(45.0)
    clock.now = 1060.0
    assert lim.wait_seconds() == 0.0


def test_limiter_back_off_holds_everyone():
    clock = FakeClock()
    lim = RpmLimiter(100, clock=clock)
    lim.back_off(23.0)
    assert lim.wait_seconds() == pytest.approx(23.0)
    lim.back_off(5.0)  # a shorter back-off never shortens the pause
    assert lim.wait_seconds() == pytest.approx(23.0)


def test_limiter_reports_countdown_while_waiting():
    lim = RpmLimiter(1, window_s=0.05, tick_s=0.01)
    seen: list[float] = []

    async def on_wait(s: float) -> None:
        seen.append(s)

    async def go() -> None:
        await lim.acquire(on_wait)
        await lim.acquire(on_wait)

    asyncio.run(go())
    assert seen and all(s > 0 for s in seen)
    assert seen == sorted(seen, reverse=True)


def test_limiter_never_exceeds_rpm_under_concurrency():
    lim = RpmLimiter(5, window_s=0.2, tick_s=0.01)
    starts: list[float] = []

    async def one() -> None:
        await lim.acquire()
        starts.append(asyncio.get_running_loop().time())

    async def go() -> None:
        await asyncio.gather(*(one() for _ in range(12)))

    asyncio.run(go())
    starts.sort()
    for i in range(len(starts) - 5):
        assert starts[i + 5] - starts[i] >= 0.2 - 0.02


# ── classify_quota_error ────────────────────────────────────────────────────

def test_classify_daily_minute_other():
    assert classify_quota_error(DAILY_429) == ("daily", None)
    assert classify_quota_error(MINUTE_429) == ("minute", 23.0)
    assert classify_quota_error(ApiError(429, "429 RESOURCE_EXHAUSTED.")) == ("minute", None)
    assert classify_quota_error(ApiError(400, "400 INVALID_ARGUMENT.")) == ("other", None)
    assert classify_quota_error(RuntimeError("Gemini TTS returned no audio content")) == ("other", None)


# ── generate_tts_item ───────────────────────────────────────────────────────

class FakeTTS:
    def __init__(self, failures: list[Exception]) -> None:
        self.failures = list(failures)
        self.calls = 0

    async def generate_speech(self, **_kwargs) -> tuple[str, float]:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return "out.wav", 2.5


@pytest.fixture
def fast_tts(monkeypatch):
    lim = RpmLimiter(1000, window_s=60.0, tick_s=0.01)
    monkeypatch.setattr(tts_job, "TTS_LIMITER", lim)
    monkeypatch.setattr(tts_job, "TTS_RETRY_DELAYS_S", [0, 0, 0, 0])
    monkeypatch.setattr(tts_job, "_calibrate_wav_to_dbfs", lambda *_a: None)
    return lim


def _run_item(service: FakeTTS, on_wait=None) -> float:
    return asyncio.run(tts_job.generate_tts_item(
        service, "hello", "out.wav", "Kore", None, "gemini-3.8-flash-tts", -20.0, on_wait=on_wait,
    ))


def test_item_daily_quota_fails_fast(fast_tts):
    service = FakeTTS([DAILY_429])
    with pytest.raises(tts_job.TtsDailyQuotaError):
        _run_item(service)
    assert service.calls == 1


def test_item_minute_quota_backs_off_shared_limiter_then_succeeds(fast_tts, monkeypatch):
    monkeypatch.setattr(tts_job, "TTS_RATE_LIMIT_DEFAULT_BACKOFF_S", 0.03)
    service = FakeTTS([ApiError(429, "429 RESOURCE_EXHAUSTED.")])
    waits: list[float] = []

    async def on_wait(s: float) -> None:
        waits.append(s)

    assert _run_item(service, on_wait) == 2.5
    assert service.calls == 2
    assert any(s > 0 for s in waits), "second attempt should have waited on the limiter"
    assert waits[-1] == 0.0  # the call started


def test_item_minute_quota_gives_up_after_max_quota_retries(fast_tts, monkeypatch):
    monkeypatch.setattr(tts_job, "TTS_RATE_LIMIT_DEFAULT_BACKOFF_S", 0.0)
    monkeypatch.setattr(tts_job, "TTS_MAX_QUOTA_RETRIES", 3)
    service = FakeTTS([ApiError(429, "429 RESOURCE_EXHAUSTED.")] * 10)
    with pytest.raises(ApiError):
        _run_item(service)
    assert service.calls == 4  # first try + 3 quota retries


def test_item_other_errors_retry_then_raise(fast_tts):
    service = FakeTTS([RuntimeError("no audio")] * 4)
    with pytest.raises(RuntimeError, match="no audio"):
        _run_item(service)
    assert service.calls == tts_job.TTS_MAX_RETRIES


def test_item_cancel_from_on_wait_propagates(monkeypatch):
    lim = RpmLimiter(1, window_s=60.0, tick_s=0.01)
    asyncio.run(lim.acquire())  # budget used: the next acquire waits
    monkeypatch.setattr(tts_job, "TTS_LIMITER", lim)
    service = FakeTTS([])

    async def on_wait(s: float) -> None:
        if s > 0:
            raise tts_job.TtsCancelled()

    with pytest.raises(tts_job.TtsCancelled):
        _run_item(service, on_wait)
    assert service.calls == 0


# ── /api/generate-tts job flow ──────────────────────────────────────────────

class FakeJobStore:
    def __init__(self) -> None:
        self.progress: list[tuple[int, str, int]] = []  # (value, text, len(partial))
        self.result: list[dict] | None = None
        self.error: str | None = None

    async def set_progress(self, _job_id, value, text, partial=None):
        self.progress.append((value, text, len(partial or [])))

    async def complete(self, _job_id, result):
        self.result = list(result)

    async def fail(self, _job_id, error):
        self.error = error

    async def is_cancel_requested(self, _job_id):
        return False


def _run_tts_job(monkeypatch, tmp_path, n_lines: int, fake_item):
    from types import SimpleNamespace
    from models.schemas import TTSGenerationRequest
    from routers import tts as tts_router

    store = FakeJobStore()
    jobs: list = []

    async def start_io_job(_type, _sid, coro_factory):
        jobs.append(coro_factory("job-1"))
        return "job-1"

    monkeypatch.setattr(tts_router, "job_store", store)
    monkeypatch.setattr(tts_router, "start_io_job", start_io_job)
    monkeypatch.setattr(tts_router, "generate_tts_item", fake_item)
    monkeypatch.setattr(tts_router, "user_sounds_dir", lambda _sid: tmp_path)
    monkeypatch.setattr(tts_router, "pick_voice", lambda *_a: "Kore")
    monkeypatch.setattr(tts_router, "resolve_language", lambda *_a: SimpleNamespace(language_code=None))
    monkeypatch.setattr(tts_router, "voice_catalog", SimpleNamespace(dialects=lambda: []))

    request = TTSGenerationRequest(texts=[{"text": f"line {i}", "copy_index": i} for i in range(n_lines)])
    req = SimpleNamespace(state=SimpleNamespace(session_id="ws", user_hash=None))

    async def go():
        await tts_router.generate_tts(request, req)
        await jobs[0]

    asyncio.run(go())
    return store


def test_job_runs_lines_in_parallel_with_append_only_partials(monkeypatch, tmp_path):
    active = 0
    peak = 0

    async def fake_item(*_a, **_k):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        return 1.5

    store = _run_tts_job(monkeypatch, tmp_path, 10, fake_item)
    assert store.error is None
    assert store.result is not None and len(store.result) == 10
    assert peak == 10  # no concurrency cap: every line starts at once
    counts = [n for _v, _t, n in store.progress]
    assert counts == sorted(counts)  # partial only grows


def test_job_daily_quota_keeps_finished_lines(monkeypatch, tmp_path):
    calls = 0
    sent = 0

    async def fake_item(*_a, on_wait=None, **_k):
        # Lines 1-3 get quota at once and succeed; line 4 hits the daily
        # quota; lines 5-10 are still waiting on the limiter when it does.
        nonlocal calls, sent
        calls += 1
        n = calls
        if n > 4:
            await asyncio.sleep(0.05)
        await on_wait(0.0)  # quota slot granted (raises if the job gave up)
        sent += 1
        if n == 4:
            raise tts_job.TtsDailyQuotaError("Daily Gemini TTS quota reached")
        await asyncio.sleep(0.01)
        return 1.0

    store = _run_tts_job(monkeypatch, tmp_path, 10, fake_item)
    assert store.error is None
    assert store.result is not None and len(store.result) == 3
    assert "7/10 speech lines not generated" in store.progress[-1][1]
    assert sent == 4  # lines still waiting for quota are dropped, not sent to Gemini


def test_job_daily_quota_with_nothing_done_fails(monkeypatch, tmp_path):
    async def fake_item(*_a, **_k):
        raise tts_job.TtsDailyQuotaError("Daily Gemini TTS quota reached")

    store = _run_tts_job(monkeypatch, tmp_path, 3, fake_item)
    assert store.result is None
    assert store.error is not None and "Daily Gemini TTS quota" in store.error
