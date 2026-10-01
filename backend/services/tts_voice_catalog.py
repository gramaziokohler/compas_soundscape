"""
Gemini 3.8 Extended Voice Library catalog.

Fetches every voice from ``client.voices.list`` (≈2 000 prebuilt voices with
``id``, ``gender``, ``language_code``, ``region_code``, ``accent``), caches the
compact list in Redis (shared by the API process and any worker) and in
process memory, and answers the questions the TTS pipeline needs:

* which dialects / accents exist (``dialects()``) — the list the frontend
  checks a typed language against;
* which voices speak a given accent with a given gender (``voices_for()``);
* the gender of a voice id (``gender_of()``), so characters keep their gender
  when their classic voice is swapped for a regional one.

Nothing here is hard-coded: when Google adds regional voices they appear after
the next refresh (TTL ``TTS_VOICE_CATALOG_TTL_SECONDS``).
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Optional

import redis as redis_sync

from config.constants import (
    REDIS_URL,
    TTS_VOICE_CATALOG_REDIS_KEY,
    TTS_VOICE_CATALOG_TTL_SECONDS,
    TTS_VOICE_CATALOG_PAGE_SIZE,
    TTS_VOICE_CATALOG_RETRY_SECONDS,
)

try:
    import google.genai as genai
    GOOGLE_GENAI_AVAILABLE = True
except ImportError:
    GOOGLE_GENAI_AVAILABLE = False

logger = logging.getLogger(__name__)

_VOICE_FIELDS = ("id", "gender", "language_code", "region_code", "accent")


class TTSVoiceCatalog:
    """Cached view of the Gemini voice library. Thread-safe; all calls are
    synchronous (use ``run_blocking`` from async code)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._voices: list[dict] = []
        self._fetched_at: float = 0.0
        self._retry_after: float = 0.0

    # ── loading ─────────────────────────────────────────────────────────
    def _fetch_remote(self) -> list[dict]:
        if not GOOGLE_GENAI_AVAILABLE or not os.getenv("GOOGLE_API_KEY"):
            raise RuntimeError("Gemini client not available")
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        voices: list[dict] = []
        token: Optional[str] = None
        while True:
            kwargs = {"page_size": TTS_VOICE_CATALOG_PAGE_SIZE}
            if token:
                kwargs["page_token"] = token
            page = client.voices.list(**kwargs)
            for v in page.voices or []:
                voices.append({f: getattr(v, f, None) for f in _VOICE_FIELDS})
            token = page.next_page_token
            if not token:
                return voices

    @staticmethod
    def _redis():
        return redis_sync.from_url(REDIS_URL, decode_responses=True)

    def _read_redis(self) -> Optional[list[dict]]:
        try:
            r = self._redis()
            try:
                raw = r.get(TTS_VOICE_CATALOG_REDIS_KEY)
            finally:
                r.close()
            if not raw:
                return None
            data = json.loads(raw)
            if time.time() - data.get("fetched_at", 0) > TTS_VOICE_CATALOG_TTL_SECONDS:
                return None
            return data.get("voices") or None
        except Exception as exc:
            logger.warning("Voice catalog Redis read failed: %s", exc)
            return None

    def _write_redis(self, voices: list[dict]) -> None:
        try:
            r = self._redis()
            try:
                r.set(TTS_VOICE_CATALOG_REDIS_KEY, json.dumps({"fetched_at": time.time(), "voices": voices}))
            finally:
                r.close()
        except Exception as exc:
            logger.warning("Voice catalog Redis write failed: %s", exc)

    def voices(self, force_refresh: bool = False) -> list[dict]:
        """Return the full compact voice list, refreshing when stale.

        On a failed refresh the last known list is kept (stale beats empty), so
        TTS never breaks because the voice library endpoint is unreachable.
        """
        with self._lock:
            fresh = time.time() - self._fetched_at < TTS_VOICE_CATALOG_TTL_SECONDS
            if self._voices and fresh and not force_refresh:
                return self._voices
            if not force_refresh and time.time() < self._retry_after:
                return self._voices
            cached = None if force_refresh else self._read_redis()
            if cached:
                self._voices, self._fetched_at = cached, time.time()
                return self._voices
            try:
                remote = self._fetch_remote()
                if remote:
                    self._voices, self._fetched_at = remote, time.time()
                    self._write_redis(remote)
            except Exception as exc:
                self._retry_after = time.time() + TTS_VOICE_CATALOG_RETRY_SECONDS
                logger.warning("Voice catalog refresh failed (keeping %d cached voices): %s",
                               len(self._voices), exc)
            return self._voices

    # ── queries ─────────────────────────────────────────────────────────
    def dialects(self) -> list[dict]:
        """Distinct accents: ``[{accent, language_code, region_code, voice_count}]``."""
        groups: dict[tuple[str, str], dict] = {}
        for v in self.voices():
            if not v.get("accent") or not v.get("language_code"):
                continue
            key = (v["language_code"], v["accent"])
            g = groups.setdefault(key, {
                "accent": v["accent"],
                "language_code": v["language_code"],
                "region_code": v.get("region_code"),
                "voice_count": 0,
            })
            g["voice_count"] += 1
        return sorted(groups.values(), key=lambda g: (g["language_code"], g["accent"]))

    def voices_for(self, accent: str, language_code: str, gender: Optional[str] = None) -> list[dict]:
        """Voices of one dialect, optionally filtered by gender, sorted by id
        (stable order so a character always maps to the same regional voice)."""
        matches = [
            v for v in self.voices()
            if v.get("accent") == accent and v.get("language_code") == language_code
        ]
        if gender:
            same = [v for v in matches if v.get("gender") == gender]
            matches = same or matches
        return sorted(matches, key=lambda v: v["id"])

    def gender_of(self, voice_id: str) -> Optional[str]:
        vid = (voice_id or "").lower()
        for v in self.voices():
            if v.get("id") == vid:
                return v.get("gender")
        return None


voice_catalog = TTSVoiceCatalog()
