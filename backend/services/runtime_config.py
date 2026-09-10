"""
Redis-backed runtime configuration shared by the API process and worker processes.

The only value stored today is the Speckle token (`config:speckle_token`). A user
can paste a token in Advanced Settings (POST /api/tokens) at runtime; the API
writes it to Redis so long-lived worker child processes (CPU / Choras) can pick
it up even though they never receive the HTTP request that set it.

Environment variables still win — deployment injects `SPECKLE_TOKEN` into every
nssm service via `deploy/.env.prod`, so those processes never touch Redis. Redis
is only consulted as a fallback when the env var is absent (e.g. a token that was
set at runtime in the UI, which only ever mutates the API process's env).
"""
from __future__ import annotations

import os

import redis as redis_sync

from config.constants import REDIS_URL

SPECKLE_TOKEN_KEY = "config:speckle_token"


def _sync_client():
    return redis_sync.from_url(REDIS_URL, decode_responses=True)


def resolve_speckle_token() -> str:
    """Return the Speckle token — env var first, Redis config as fallback."""
    token = os.getenv("SPECKLE_TOKEN")
    if token:
        return token
    try:
        r = _sync_client()
        try:
            return r.get(SPECKLE_TOKEN_KEY) or ""
        finally:
            r.close()
    except Exception:
        return ""


def set_speckle_token(token: str) -> None:
    """Persist (or clear) the Speckle token in Redis for worker processes."""
    try:
        r = _sync_client()
        try:
            if token:
                r.set(SPECKLE_TOKEN_KEY, token)
            else:
                r.delete(SPECKLE_TOKEN_KEY)
        finally:
            r.close()
    except Exception as exc:
        print(f"[runtime_config] failed to persist Speckle token to Redis: {exc}")


def speckle_token_is_set() -> bool:
    return bool(resolve_speckle_token())
