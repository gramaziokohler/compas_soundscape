from fastapi import APIRouter, HTTPException
from services.audio_service import AudioService
from pydantic import BaseModel
from config.constants import GENERATED_SOUNDS_DIR
import os

router = APIRouter()

# This will be injected by main.py
audio_service = None


def init_reprocess_router(service: AudioService):
    """Initialize router with audio service"""
    global audio_service
    audio_service = service


class ReprocessRequest(BaseModel):
    sound_urls: list[str]
    apply_denoising: bool


@router.post("/api/reprocess-sounds")
async def reprocess_sounds(request: ReprocessRequest):
    """
    Reprocess existing sounds to add or remove denoising.
    Takes a list of sound URLs and applies/removes noise reduction.
    """
    try:
        reprocessed_sounds = []
        
        for url in request.sound_urls:
            # Extract filename from URL (e.g., "/static/sounds/generated/filename.wav")
            filename = os.path.basename(url)
            file_path = os.path.join(GENERATED_SOUNDS_DIR, filename)
            
            if not os.path.exists(file_path):
                print(f"Warning: File not found: {file_path}")
                continue
            
            # Reprocess the audio file
            try:
                audio_service.reprocess_audio_file(file_path, request.apply_denoising)
                reprocessed_sounds.append(url)
            except Exception as e:
                print(f"Error reprocessing {filename}: {str(e)}")
                continue
        
        return {
            "success": True,
            "reprocessed_count": len(reprocessed_sounds),
            "sounds": reprocessed_sounds
        }
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error reprocessing sounds: {str(e)}")
