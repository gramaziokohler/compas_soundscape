import os
import uuid
import tempfile
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from services.audio_service import AudioService
from models.schemas import SoundGenerationRequest
from config.constants import GENERATED_SOUNDS_DIR, GENERATED_SOUND_URL_PREFIX, DEFAULT_SPL_DB

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
            request.audio_model 
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


@router.post("/api/calibrate-audio")
async def calibrate_audio(
    audio: UploadFile = File(...),
    spl_db: float = Form(DEFAULT_SPL_DB),
    apply_denoising: bool = Form(False),
):
    """
    Normalize RMS + apply SPL calibration to any uploaded audio file.
    Used by Upload, Library, Catalog, Sample-audio, and ElevenLabs modes so that
    all audio sources are treated consistently with ML-generated audio.
    Returns a static URL to the calibrated WAV file.
    """
    tmp_input = None
    try:
        # Save the uploaded audio to a temp file
        ext = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
        tmp_input = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp_input.write(await audio.read())
        tmp_input.close()

        # Build output path inside the generated sounds directory
        filename = f"calibrated_{uuid.uuid4().hex}_{int(spl_db)}dB.wav"
        output_path = os.path.join(GENERATED_SOUNDS_DIR, filename)
        os.makedirs(GENERATED_SOUNDS_DIR, exist_ok=True)

        audio_service.calibrate_audio_file(
            tmp_input.name,
            output_path,
            target_spl_db=spl_db,
            apply_denoising=apply_denoising,
        )

        return {"url": f"{GENERATED_SOUND_URL_PREFIX}/{filename}"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calibration failed: {str(e)}")

    finally:
        if tmp_input and os.path.exists(tmp_input.name):
            os.unlink(tmp_input.name)


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
