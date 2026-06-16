from fastapi import APIRouter, HTTPException, Request
from services.audio_service import AudioService
from services.paths import user_sounds_dir
from pydantic import BaseModel
from config.constants import GENERATED_SOUNDS_DIR
import os

router = APIRouter()

audio_service = None


def init_reprocess_router(service: AudioService):
    global audio_service
    audio_service = service


class ReprocessRequest(BaseModel):
    sound_urls: list[str]
    apply_denoising: bool
    trim_silence: bool = False


@router.post("/api/reprocess-sounds")
async def reprocess_sounds(request: ReprocessRequest, req: Request):
    """
    Reprocess existing sounds to add or remove denoising.
    Takes a list of sound URLs and applies/removes noise reduction.
    """
    try:
        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if session_id:
            sounds_dir = str(user_sounds_dir(session_id))
        else:
            sounds_dir = GENERATED_SOUNDS_DIR

        reprocessed_sounds = []

        for url in request.sound_urls:
            filename = os.path.basename(url)
            file_path = os.path.join(sounds_dir, filename)

            if not os.path.exists(file_path):
                print(f"Warning: File not found: {file_path}")
                continue

            try:
                audio_service.reprocess_audio_file(file_path, request.apply_denoising, trim_silence=request.trim_silence)
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
