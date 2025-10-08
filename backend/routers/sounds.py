from fastapi import APIRouter, HTTPException
from services.audio_service import AudioService
from models.schemas import SoundGenerationRequest

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
    """
    try:
        output_dir = './static/sounds/generated'

        generated_files = audio_service.generate_multiple_sounds(
            request.sounds,
            output_dir,
            request.bounding_box
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
