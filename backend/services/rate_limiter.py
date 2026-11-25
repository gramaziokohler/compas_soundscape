"""
Request-rate limiting for external APIs called from the API process.

Gemini TTS quotas count requests per minute (RPM) and per day (RPD) for each
project; there is no concurrency limit. So TTS calls are not capped by a
semaphore: every call waits only on ``TTS_LIMITER``, a sliding 60 s window
shared by all TTS jobs. A user alone gets the whole budget; several users
share it in arrival order.

The limiter lives in this process only. Production runs one uvicorn process
(``CompasApi``), so the budget is shared by every TTS job. Move it to Redis
before running the API with ``--workers``.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Awaitable, Callable, Optional

from config.constants import (
    TTS_RATE_LIMIT_TICK_S,
    TTS_RPM_LIMIT,
    TTS_RPM_WINDOW_S,
)

OnWait = Callable[[float], Awaitable[None]]


class RpmLimiter:
    """Sliding-window limiter: at most ``rpm`` acquisitions per ``window_s``.

    ``acquire()`` sleeps in ticks of at most ``tick_s`` and calls ``on_wait``
    with the seconds left before each tick, so callers can show a countdown.
    ``back_off()`` pauses every caller after the API itself returned a
    per-minute 429 (our count and Google's can drift, e.g. after a restart).
    """

    def __init__(
        self,
        rpm: int,
        window_s: float = TTS_RPM_WINDOW_S,
        tick_s: float = TTS_RATE_LIMIT_TICK_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.rpm = max(1, rpm)
        self.window_s = window_s
        self.tick_s = tick_s
        self._clock = clock
        self._stamps: deque[float] = deque()
        self._blocked_until = 0.0
        self._lock = asyncio.Lock()

    def wait_seconds(self) -> float:
        """Seconds until the next acquisition would be allowed (0 = now)."""
        now = self._clock()
        while self._stamps and now - self._stamps[0] >= self.window_s:
            self._stamps.popleft()
        wait = max(0.0, self._blocked_until - now)
        if len(self._stamps) >= self.rpm:
            wait = max(wait, self.window_s - (now - self._stamps[0]))
        return wait

    async def acquire(self, on_wait: Optional[OnWait] = None) -> None:
        while True:
            async with self._lock:
                wait = self.wait_seconds()
                if wait <= 0:
                    self._stamps.append(self._clock())
                    return
            if on_wait is not None:
                await on_wait(wait)
            await asyncio.sleep(min(wait, self.tick_s))

    def back_off(self, seconds: float) -> None:
        """Hold every caller for ``seconds`` (from a 429's retryDelay)."""
        self._blocked_until = max(self._blocked_until, self._clock() + seconds)


TTS_LIMITER = RpmLimiter(TTS_RPM_LIMIT)
