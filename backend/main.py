# backend/main.py

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.genai as genai

# Import services
from services.llm_service import LLMService
from services.audio_service import AudioService

# Import routers
from routers import upload, analysis, generation, sounds, sed_analysis, library_search, reprocess

# Import utilities
from utils.file_operations import cleanup_all_temp_directories

# Import constants
from config.constants import (
    CORS_ORIGIN_LOCALHOST,
    CORS_ORIGIN_FRONTEND,
    STATIC_MOUNT_PATH,
    STATIC_FILES_DIRECTORY
)

# --- Initialization ---

# Load environment variables from the .env file
load_dotenv()

# Configure the Google AI client with the API key from the environment
api_key = os.getenv("GOOGLE_API_KEY")

client = genai.Client()
if not client:
    print("Warning: GOOGLE_API_KEY environment variable not set.")

# Initialize services
llm_service = LLMService(client)
audio_service = AudioService()

# Initialize routers with services
generation.init_generation_router(llm_service)
sounds.init_sounds_router(audio_service)
reprocess.init_reprocess_router(audio_service)


# --- Application Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager.
    Handles startup and shutdown events.
    """
    # Startup: Clean up all temporary directories
    print("Starting up: Cleaning temporary directories...")
    cleanup_all_temp_directories()
    print("Startup complete.")
    
    yield
    
    # Shutdown: Add any cleanup needed on shutdown here
    print("Shutting down...")


# Launch the API
app = FastAPI(lifespan=lifespan)

# This makes files in "static/" available at "http://.../static/"
app.mount(STATIC_MOUNT_PATH, StaticFiles(directory=STATIC_FILES_DIRECTORY), name="static")

# --- CORS Middleware ---
origins = [CORS_ORIGIN_LOCALHOST, CORS_ORIGIN_FRONTEND]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Include Routers ---
app.include_router(upload.router)
app.include_router(analysis.router)
app.include_router(generation.router)
app.include_router(sounds.router)
app.include_router(sed_analysis.router)
app.include_router(library_search.router)
app.include_router(reprocess.router)


@app.get("/")
def read_root():
    return {"message": "COMPAS Soundscape API is running"}
