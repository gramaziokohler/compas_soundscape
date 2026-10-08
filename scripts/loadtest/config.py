"""Load-test constants and run configuration (single source of truth)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Pick up CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET from the repo-root
# .env.local (admin-only secrets, never shipped). Shell env vars still win.
load_dotenv(Path(__file__).resolve().parents[2] / ".env.local", override=False)

# ─── Defaults ────────────────────────────────────────────────────────────────
DEFAULT_BASE_URL = "https://soundisblue.com"
DEFAULT_USERS = 20
DEFAULT_RAMP_S = 60
DEFAULT_DURATION_S = 600
DEFAULT_PYROOM_JOBS = 20   # one per user
DEFAULT_SOUND_JOBS = 5
DEFAULT_LLM_STREAMS = 5

# ─── Timing (mirrors the frontend) ───────────────────────────────────────────
JOB_POLL_INTERVAL_S = 1.0          # frontend/src/utils/constants.ts job polling
PRESENCE_INTERVAL_S = 25.0         # workspaceStore presence heartbeat
QUEUE_SAMPLE_INTERVAL_S = 5.0
BROWSE_PAUSE_RANGE_S = (2.0, 5.0)
SOUNDSCAPE_SAVE_INTERVAL_S = 15.0  # well above the 3 s autosave, to keep disk churn sane

# ─── Timeouts ────────────────────────────────────────────────────────────────
HTTP_TIMEOUT_S = 60.0
CONNECT_TIMEOUT_S = 15.0
# Drop idle keep-alive connections before uvicorn does (its default is 5 s);
# otherwise reusing a just-closed socket shows up as a false ReadError.
KEEPALIVE_EXPIRY_S = 4.0
PYROOM_TIMEOUT_S = 900
SOUND_TIMEOUT_S = 1800
LLM_STREAM_TIMEOUT_S = 300
MAX_STATIC_ASSETS = 40             # cap on /_next/static files fetched per page load

# ─── Backend limits we respect / classify ────────────────────────────────────
GPU_QUEUE_PER_SESSION_MAX = 3      # backend/config/constants.py → 429 above this
THROTTLED_STATUS = 429

# ─── Auth (Cloudflare Access service token) ──────────────────────────────────
CF_CLIENT_ID_ENV = "CF_ACCESS_CLIENT_ID"
CF_CLIENT_SECRET_ENV = "CF_ACCESS_CLIENT_SECRET"
CF_CLIENT_ID_HEADER = "CF-Access-Client-Id"
CF_CLIENT_SECRET_HEADER = "CF-Access-Client-Secret"
LOADTEST_USER_HEADER = "X-Loadtest-User"   # backend LOADTEST_USER_HEADER
USER_AGENT = "compas-loadtest/1.0"

# ─── Output ──────────────────────────────────────────────────────────────────
RESULTS_DIR_NAME = "results"


@dataclass(frozen=True)
class RunConfig:
    base_url: str
    users: int
    ramp_s: float
    duration_s: float
    pyroom_jobs: int
    sound_jobs: int
    llm_streams: int
    audio_model: str | None
    verify_tls: bool

    @property
    def cf_client_id(self) -> str:
        return os.environ.get(CF_CLIENT_ID_ENV, "").strip()

    @property
    def cf_client_secret(self) -> str:
        return os.environ.get(CF_CLIENT_SECRET_ENV, "").strip()

    @property
    def has_service_token(self) -> bool:
        return bool(self.cf_client_id and self.cf_client_secret)
