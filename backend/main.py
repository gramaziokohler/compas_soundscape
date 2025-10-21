# backend/main.py

import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.genai as genai

# Import services
from services.llm_service import LLMService
from services.audio_service import AudioService

# Import routers
from routers import upload, analysis, generation, sounds, sed_analysis, library_search

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

# Launch the API
app = FastAPI()

# This makes files in "static/" available at "http://.../static/"
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- CORS Middleware ---
origins = ["http://localhost", "http://localhost:3000"]
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


@app.get("/")
def read_root():
    return {"message": "COMPAS Soundscape API is running"}
