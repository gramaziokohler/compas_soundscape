from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from services.audio_service import AudioService
from models.schemas import SoundGenerationRequest
from config.constants import GENERATED_SOUNDS_DIR
import os

router = APIRouter()

# This will be injected by main.py
audio_service = None


def init_sounds_router(service: AudioService):
    """Initialize router with audio service"""
    global audio_service
    audio_service = service


@router.post("/api/generate-sounds")
async def generate_sounds(request: SoundGenerationRequest):
    """
    Generates multiple audio files based on text prompts with configurable parameters.
    Returns URLs to the generated audio files.
    If bounding_box is provided, positions sounds randomly within the geometry bounds.
    Supports multiple audio generation models (TangoFlux, AudioLDM2).
    """
    try:
        generated_files = audio_service.generate_multiple_sounds(
            request.sounds,
            GENERATED_SOUNDS_DIR,
            request.bounding_box,
            request.apply_denoising,
            request.audio_model.value  # Convert enum to string
        )

        return {"sounds": generated_files}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating sounds: {str(e)}")


@router.post("/api/cleanup-generated-sounds")
async def cleanup_generated_sounds():
    """
    Deletes all generated sound files when session ends.
    Supports both DELETE and POST methods for compatibility with sendBeacon.
    """
    try:
        audio_service.cleanup_generated_sounds()
        return {"message": "Cleanup successful"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during cleanup: {str(e)}")


@router.get("/api/sample-audio")
async def get_sample_audio():
    """
    Returns the sample French audio file: Le Corbeau et le Renard (french).wav
    """
    try:
        # Path to the sample audio file
        sample_audio_path = os.path.join("data", "Le Corbeau et le Renard (french).wav")

        if not os.path.exists(sample_audio_path):
            raise HTTPException(status_code=404, detail="Sample audio file not found")

        return FileResponse(
            path=sample_audio_path,
            media_type="audio/wav",
            filename="Le Corbeau et le Renard (french).wav"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving sample audio: {str(e)}")
