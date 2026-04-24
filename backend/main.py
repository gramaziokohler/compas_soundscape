# backend/main.py

import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv, find_dotenv
# Import services
from services.llm_service import LLMService
from services.audio_service import AudioService
from services.impulse_response_service import ImpulseResponseService
# from services.modal_analysis_service import ModalAnalysisService

# Import routers
from routers import upload, generation, sounds, sed_analysis, sed_extract, library_search, reprocess, impulse_responses, modal_analysis, choras, pyroomacoustics, speckle, soundscape, tokens

# Import utilities
from utils.file_operations import cleanup_all_temp_directories, ensure_all_temp_directories

# Import constants
from config.constants import (
    CORS_ALLOW_ALL,
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
# modal_service = ModalAnalysisService()

# Initialize routers with services
generation.init_generation_router(llm_service)
sounds.init_sounds_router(audio_service)
reprocess.init_reprocess_router(audio_service)
impulse_responses.init_impulse_response_router(ir_service)
sed_extract.init_sed_extract_router(audio_service)
# modal_analysis.init_modal_analysis_router(modal_service)

# --- Ensure all directories exist before mounting static files ---
ensure_all_temp_directories()


# --- Application Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager.
    Handles startup and shutdown events.
    """
    # Startup: clean temp files/empty dirs, then recreate required dirs
    print("Starting up: Cleaning temporary directories...")
    cleanup_all_temp_directories()
    ensure_all_temp_directories()
    print("Startup complete.")
    
    yield
    
    # Shutdown: Add any cleanup needed on shutdown here
    print("Shutting down...")


# Launch the API
app = FastAPI(lifespan=lifespan)

# This makes files in "static/" available at "http://.../static/"
app.mount(STATIC_MOUNT_PATH, StaticFiles(directory=STATIC_FILES_DIRECTORY), name="static")

# Mount impulse response directory
app.mount(
    "/static/impulse_responses",
    StaticFiles(directory=IMPULSE_RESPONSE_DIR),
    name="impulse_responses"
)

# Mount simulations directory for Choras/Pyroomacoustics results
app.mount(
    "/static/temp",
    StaticFiles(directory=TEMP_SIMULATIONS_DIR),
    name="temp"
)

# Mount soundscapes directory (persistent, outside temp/)
app.mount(
    SOUNDSCAPE_DATA_URL_PREFIX,
    StaticFiles(directory=SOUNDSCAPE_DATA_DIR),
    name="soundscapes"
)

# Mount Choras RIR output directory
app.mount(
    "/static/choras_rir",
    StaticFiles(directory=CHORAS_RIR_DIR),
    name="choras_rir"
)

# --- CORS Middleware ---
# Allow all origins for network access (development mode)
# For production, restrict to specific origins: [CORS_ORIGIN_LOCALHOST, CORS_ORIGIN_FRONTEND, CORS_ORIGIN_NETWORK]
origins = [CORS_ALLOW_ALL]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
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

    return {
        "pyroomacoustics": PyroomacousticsService.get_service_version_info(),
        "tangoflux": AudioService.get_service_version_info(),
        "audioldm2": AudioLDM2Service.get_service_version_info(),
        "bbc": bbc_version_info(),
        "llm_providers": LLMService.get_service_version_info(),
        "yamnet": SEDService.get_service_version_info(),
        "acousticDE": ChorasService.get_de_version_info(),
        "edg_acoustics": ChorasService.get_dg_version_info(),
    }
