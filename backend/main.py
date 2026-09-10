# backend/main.py

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from starlette.requests import Request
from starlette.responses import Response
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from middleware.session import SessionMiddleware
from dotenv import load_dotenv, find_dotenv
# Import services
from services.llm_service import LLMService
from services.audio_service import AudioService
from services.impulse_response_service import ImpulseResponseService
from services.tts_service import TTSService
from services.job_store import job_store
from services.io_jobs import sweep_orphaned_io_jobs
# from services.modal_analysis_service import ModalAnalysisService

# Import routers
from routers import upload, generation, sounds, sed_analysis, sed_extract, library_search, reprocess, impulse_responses, modal_analysis, choras, pyroomacoustics, speckle, soundscape, tokens, tts, loop_analysis, jobs

# Import constants
from config.constants import (
    JOB_REAPER_INTERVAL_S,
    TEMP_JANITOR_INTERVAL_S,
    TEMP_JANITOR_MAX_AGE_H,
    REDIS_URL,
)

# Import utilities
from utils.file_operations import ensure_all_temp_directories, janitor_cleanup_temp

# Import constants
from config.constants import (
    STATIC_MOUNT_PATH,
    STATIC_FILES_DIRECTORY,
    IMPULSE_RESPONSE_DIR,
    TEMP_SIMULATIONS_DIR,
    SOUNDSCAPE_DATA_DIR,
    SOUNDSCAPE_DATA_URL_PREFIX,
    CHORAS_RIR_DIR,
    )

# --- Initialization ---

# Load environment variables — .env.local takes precedence over .env.
# find_dotenv() searches upward from main.py's directory, so it finds files
# at the repo root even when uvicorn is launched from a different CWD.
_env_local = find_dotenv('.env.local', raise_error_if_not_found=False, usecwd=False)
_env = find_dotenv('.env', raise_error_if_not_found=False, usecwd=False)
if _env_local:
    load_dotenv(_env_local, override=True)   # admin overrides (not shipped to users)
if _env:
    load_dotenv(_env)
print(f"[env] .env.local: {_env_local or 'not found'}")
print(f"[env] .env:       {_env or 'not found'}")

# Configure the Google AI client — optional; user can supply the key at runtime
from services.llm_service import GOOGLE_GENAI_AVAILABLE

api_key = os.getenv("GOOGLE_API_KEY")
if GOOGLE_GENAI_AVAILABLE and api_key:
    import google.genai as genai
    client = genai.Client()
elif not GOOGLE_GENAI_AVAILABLE:
    client = None
    print("Warning: google-genai package not installed — Gemini LLM disabled.")
else:
    client = None
    print("Warning: GOOGLE_API_KEY not set — Gemini LLM disabled until configured in Advanced Settings.")

# Initialize services
llm_service = LLMService(client)
audio_service = AudioService()
ir_service = ImpulseResponseService()
tts_service_instance = TTSService()
# modal_service = ModalAnalysisService()

# Initialize routers with services
generation.init_generation_router(llm_service)
sounds.init_sounds_router(audio_service)
reprocess.init_reprocess_router(audio_service)
impulse_responses.init_impulse_response_router(ir_service)
sed_extract.init_sed_extract_router(audio_service)
tts.init_tts_router(tts_service_instance)
# modal_analysis.init_modal_analysis_router(modal_service)

# --- Ensure all directories exist before mounting static files ---
ensure_all_temp_directories()


class NoStoreStaticFiles(StaticFiles):
    """StaticFiles that always sends `Cache-Control: no-store`.

    Generated audio, IRs, analysis JSONs and saved soundscape files are written
    in place / deleted at runtime (reprocess, calibrate, delete-sound, save),
    so browsers and Cloudflare must never serve a stale copy of the same URL.
    """

    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        return response


# --- Application Lifespan ---
async def _job_store_loop() -> None:
    """Supervise Redis-dependent background work for the whole API process.

    Combines the orphaned-IO sweep (once, when Redis first answers) and the
    stale-heartbeat reaper. It runs continuously so a late-starting Redis (local
    dev, no nssm) is picked up without an API restart, and it logs a single
    clear warning when Redis is unreachable instead of spamming an exception
    trace every cycle.
    """
    reported_down = False
    swept = False
    while True:
        try:
            await job_store.redis.ping()
        except Exception:
            if not reported_down:
                print(
                    "[job-store] Redis is not reachable at "
                    f"{REDIS_URL}. Start Redis first (see deploy/README.md) - "
                    "background jobs are disabled until it is up. Retrying..."
                )
                reported_down = True
            await asyncio.sleep(JOB_REAPER_INTERVAL_S)
            continue

        if reported_down:
            print("[job-store] Redis connection restored — background jobs enabled.")
            reported_down = False

        # Sweep IO jobs orphaned by a previous process (in-process asyncio jobs
        # die with the API — see services/io_jobs.py). Only meaningful once per
        # process lifetime, but deferred until Redis is actually reachable.
        if not swept:
            try:
                swept_count = await sweep_orphaned_io_jobs()
                if swept_count:
                    print(f"[job-store] marked {swept_count} orphaned in-process IO job(s) as error")
            except Exception as exc:
                print(f"[job-store] orphaned-IO sweep failed: {exc}")
            swept = True

        try:
            await job_store.reap_once()
        except Exception as exc:
            print(f"[job-reaper] error: {exc}")
        await asyncio.sleep(JOB_REAPER_INTERVAL_S)


async def _temp_janitor_loop() -> None:
    """Hourly age-based cleanup of temp/ (replaces the startup wipe)."""
    while True:
        await asyncio.sleep(TEMP_JANITOR_INTERVAL_S)
        try:
            await asyncio.to_thread(janitor_cleanup_temp, TEMP_JANITOR_MAX_AGE_H)
        except Exception as exc:
            print(f"[temp-janitor] error: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager.
    Handles startup and shutdown events.
    """
    # Startup: recreate required dirs, then start the Redis job-store supervisor
    # (orphaned-IO sweep + reaper) and the temp janitor. NOTE: temp/ files are
    # NOT wiped at startup anymore — that destroyed every user's live audio on
    # redeploy. If Redis is down (local dev), the supervisor logs one clear
    # warning and keeps retrying instead of erroring on every tick.
    print("Starting up: ensuring temp directories...")
    ensure_all_temp_directories()

    job_store_task = asyncio.create_task(_job_store_loop())
    janitor_task = asyncio.create_task(_temp_janitor_loop())
    print("Startup complete.")

    yield

    # Shutdown: Add any cleanup needed on shutdown here
    print("Shutting down...")
    job_store_task.cancel()
    janitor_task.cancel()
    await job_store.close()


# Launch the API
app = FastAPI(lifespan=lifespan)

# This makes files in "static/" available at "http://.../static/"
app.mount(STATIC_MOUNT_PATH, NoStoreStaticFiles(directory=STATIC_FILES_DIRECTORY), name="static")

# Mount impulse response directory
app.mount(
    "/static/impulse_responses",
    NoStoreStaticFiles(directory=IMPULSE_RESPONSE_DIR),
    name="impulse_responses"
)

# Mount simulations directory for Choras/Pyroomacoustics results
app.mount(
    "/static/temp",
    NoStoreStaticFiles(directory=TEMP_SIMULATIONS_DIR),
    name="temp"
)

# Mount soundscapes directory (persistent, outside temp/)
app.mount(
    SOUNDSCAPE_DATA_URL_PREFIX,
    NoStoreStaticFiles(directory=SOUNDSCAPE_DATA_DIR),
    name="soundscapes"
)

# Mount Choras RIR output directory
app.mount(
    "/static/choras_rir",
    NoStoreStaticFiles(directory=CHORAS_RIR_DIR),
    name="choras_rir"
)

# --- Session Middleware (before CORS) ---
app.add_middleware(SessionMiddleware)

# --- Build CORS origins from environment ---
cors_origins: list[str]
allow_credentials: bool
allow_all = os.getenv("CORS_ALLOW_ALL", "").lower() in ("true", "1", "yes")
if allow_all:
    cors_origins = ["*"]
    allow_credentials = False
else:
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
    cors_origins = [frontend_origin]
    allow_credentials = True

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Include Routers ---
app.include_router(upload.router)
# app.include_router(analysis.router)
app.include_router(generation.router)
app.include_router(sounds.router)
app.include_router(sed_analysis.router)
app.include_router(sed_extract.router)
app.include_router(library_search.router)
app.include_router(reprocess.router)
app.include_router(impulse_responses.router)
# app.include_router(modal_analysis.router)
app.include_router(choras.router)
app.include_router(pyroomacoustics.router)
app.include_router(speckle.router)
app.include_router(soundscape.router)
app.include_router(tokens.router)
app.include_router(tts.router)
app.include_router(loop_analysis.router)
app.include_router(jobs.router)


@app.get("/")
def read_root():
    return {"message": "COMPAS Soundscape API is running"}


@app.get("/api/versions")
def get_service_versions(llm_model: str = None):
    """Return name and version of every backend service library."""
    from services.pyroomacoustics_service import PyroomacousticsService
    from services.audio_service import AudioService
    from services.audioldm2_service import AudioLDM2Service
    from services.bbc_service import get_service_version_info as bbc_version_info
    from services.llm_service import LLMService
    from services.sed_service import SEDService
    from services.choras_service import ChorasService
    from services.tts_service import TTSService

    return {
        "pyroomacoustics": PyroomacousticsService.get_service_version_info(),
        "tangoflux": AudioService.get_service_version_info(),
        "audioldm2": AudioLDM2Service.get_service_version_info(),
        "bbc": bbc_version_info(),
        "llm_providers": LLMService.get_service_version_info(),
        "yamnet": SEDService.get_service_version_info(),
        "acousticDE": ChorasService.get_de_version_info(),
        "edg_acoustics": ChorasService.get_dg_version_info(),
        "gemini-tts": TTSService.get_service_version_info(),
    }
