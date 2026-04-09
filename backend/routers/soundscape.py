# backend/routers/soundscape.py
# Soundscape Data Persistence Endpoints (Save/Load to Speckle + Local Audio Storage)

import os
import shutil
import logging
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from services.speckle_service import SpeckleService
from models.schemas import (
    SoundscapeSaveRequest,
    SoundscapeSaveResponse,
    SoundscapeLoadResponse,
    SoundscapeData,
)
from config.constants import (
    SOUNDSCAPE_DATA_DIR,
    SOUNDSCAPE_DATA_URL_PREFIX,
    GENERATED_SOUNDS_DIR,
    IMPULSE_RESPONSE_DIR,
    PYROOMACOUSTICS_RIR_DIR,
    TEMP_SIMULATIONS_DIR,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speckle/soundscape", tags=["soundscape"])

# Reuse the same SpeckleService singleton as speckle.py
speckle_service = SpeckleService()


def _ensure_authenticated() -> None:
    """Authenticate and initialise the Speckle project if not already done."""
    if not speckle_service.client:
        if not speckle_service.authenticate():
            raise HTTPException(
                status_code=503, detail="Failed to authenticate with Speckle"
            )
        speckle_service.get_or_create_project()

    if not speckle_service.project_id:
        speckle_service.get_or_create_project()
        if not speckle_service.project_id:
            raise HTTPException(
                status_code=503, detail="Speckle project not available"
            )


def _copy_audio_files(model_id: str, audio_urls: list[str]) -> int:
    """
    Copy audio files from the generated sounds directory to the
    model-specific soundscape folder.

    Args:
        model_id: Speckle model ID (used as folder name).
        audio_urls: List of audio URL paths (e.g. "/static/sounds/generated/foo.wav").

    Returns:
        Number of files successfully copied.
    """
    dest_dir = Path(SOUNDSCAPE_DATA_DIR) / model_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for url in audio_urls:
        # Extract filename from URL path like "/static/sounds/generated/foo.wav"
        filename = os.path.basename(url)
        if not filename:
            continue

        # Try to find the source file in the generated sounds dir
        source = Path(GENERATED_SOUNDS_DIR) / filename
        if not source.exists():
            logger.warning(f"Audio source not found: {source}")
            continue

        dest = dest_dir / filename
        try:
            shutil.copy2(str(source), str(dest))
            copied += 1
        except Exception as e:
            logger.warning(f"Failed to copy {filename}: {e}")

    return copied


def _copy_ir_files(model_id: str, ir_urls: list[str]) -> int:
    """
    Copy impulse response files from temp directories to the
    model-specific soundscape folder.

    Args:
        model_id: Speckle model ID (used as folder name).
        ir_urls: List of IR URL paths (e.g. "/static/impulse_responses/foo.wav").

    Returns:
        Number of files successfully copied.
    """
    dest_dir = Path(SOUNDSCAPE_DATA_DIR) / model_id / "ir_files"
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for url in ir_urls:
        filename = os.path.basename(url)
        if not filename:
            continue

        # Try impulse_responses dir first, then pyroomacoustics_rir dir
        source = Path(IMPULSE_RESPONSE_DIR) / filename
        if not source.exists():
            source = Path(PYROOMACOUSTICS_RIR_DIR) / filename
        if not source.exists():
            logger.warning(f"IR source not found: {filename}")
            continue

        dest = dest_dir / filename
        try:
            shutil.copy2(str(source), str(dest))
            copied += 1
        except Exception as e:
            logger.warning(f"Failed to copy IR {filename}: {e}")

    return copied


def _copy_results_json(model_id: str, simulation_id: str) -> bool:
    """
    Copy simulation results JSON to the model-specific soundscape folder.

    Args:
        model_id: Speckle model ID.
        simulation_id: Simulation UUID.

    Returns:
        True if copy succeeded.
    """
    source = Path(TEMP_SIMULATIONS_DIR) / f"simulation_{simulation_id}_results.json"
    if not source.exists():
        logger.debug(f"Results JSON not found: {source}")
        return False

    dest_dir = Path(SOUNDSCAPE_DATA_DIR) / model_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"simulation_{simulation_id}_results.json"

    try:
        shutil.copy2(str(source), str(dest))
        return True
    except Exception as e:
        logger.warning(f"Failed to copy results JSON: {e}")
        return False


@router.post("/save", response_model=SoundscapeSaveResponse)
async def save_soundscape(request: SoundscapeSaveRequest):
    """
    Save soundscape data to Speckle with local audio file storage.

    1. Creates a local folder at SOUNDSCAPE_DATA_DIR/{model_id}/
    2. Copies referenced audio/IR files from generated sounds dir
    3. Sends metadata to Speckle as a versioned Collection object
    """
    data = request.soundscape_data
    model_id = data.model_id

    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    # Fill created_at if empty
    if not data.created_at:
        data.created_at = datetime.now(timezone.utc).isoformat()

    # 1. Create local folder
    local_folder = Path(SOUNDSCAPE_DATA_DIR) / model_id
    local_folder.mkdir(parents=True, exist_ok=True)

    # 2. Copy audio files
    audio_copied = _copy_audio_files(model_id, request.audio_urls)
    logger.info(f"Copied {audio_copied}/{len(request.audio_urls)} audio files")

    # 2b. Copy IR files
    ir_copied = _copy_ir_files(model_id, request.ir_urls)
    logger.info(f"Copied {ir_copied}/{len(request.ir_urls)} IR files")

    # 2c. Copy simulation results JSON files
    for sim_config in data.simulation_configs:
        if sim_config.current_simulation_id:
            _copy_results_json(model_id, sim_config.current_simulation_id)

    # 3. Send to Speckle (sole source of truth for soundscape metadata)
    soundscape_dict = data.model_dump()
    speckle_object_id = None
    try:
        _ensure_authenticated()
        speckle_object_id = speckle_service.send_soundscape_data(
            model_id=model_id,
            soundscape_data=soundscape_dict,
        )
    except Exception as e:
        logger.warning(f"Speckle upload failed (local save succeeded): {e}")

    return SoundscapeSaveResponse(
        success=True,
        speckle_object_id=speckle_object_id,
        local_folder=str(local_folder),
        audio_files_copied=audio_copied,
        ir_files_copied=ir_copied,
        message=(
            f"Saved {len(data.sound_configs)} configs, "
            f"{len(data.sound_events)} events, "
            f"{audio_copied} audio files, "
            f"{ir_copied} IR files, "
            f"{len(data.simulation_configs)} simulations"
            + (f" (Speckle: {speckle_object_id})" if speckle_object_id else " (Speckle upload failed)")
        ),
    )


@router.get("/{model_id}", response_model=SoundscapeLoadResponse)
async def load_soundscape(model_id: str):
    """
    Load soundscape data for a model from Speckle.

    Also restores IR files from persistent storage back to temp library.
    """
    audio_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{model_id}"
    ir_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{model_id}/ir_files"

    # 0. Restore IR files from persistent storage back to temp library
    #    so that the IR listing endpoint can find them after server restart
    ir_files_dir = Path(SOUNDSCAPE_DATA_DIR) / model_id / "ir_files"
    if ir_files_dir.exists():
        dest_dir = Path(IMPULSE_RESPONSE_DIR)
        dest_dir.mkdir(parents=True, exist_ok=True)
        restored_count = 0
        for ir_file in ir_files_dir.glob("*.wav"):
            dest = dest_dir / ir_file.name
            if not dest.exists():
                try:
                    shutil.copy2(str(ir_file), str(dest))
                    restored_count += 1
                except Exception as e:
                    logger.warning(f"Failed to restore IR file {ir_file.name}: {e}")
        if restored_count > 0:
            logger.info(f"Restored {restored_count} IR files to temp library")

    # Load from Speckle (sole source of truth)
    try:
        _ensure_authenticated()
        speckle_data = speckle_service.get_soundscape_data(model_id)
        if speckle_data:
            soundscape = SoundscapeData(**speckle_data)
            logger.info("Loaded soundscape from Speckle")
            return SoundscapeLoadResponse(
                soundscape_data=soundscape,
                audio_base_url=audio_base_url,
                ir_base_url=ir_base_url,
                found=True,
            )
    except Exception as e:
        logger.warning(f"Speckle soundscape lookup failed: {e}")

    # Not found
    return SoundscapeLoadResponse(
        soundscape_data=None,
        audio_base_url=audio_base_url,
        ir_base_url=ir_base_url,
        found=False,
    )


@router.post("/{model_id}/upload-audio")
async def upload_soundscape_audio(
    model_id: str,
    sound_id: str = Form(...),
    audio: UploadFile = File(...),
):
    """
    Upload an audio file (from a blob URL) to the soundscape folder.

    Used for library and uploaded sounds whose audio only exists as a
    browser blob URL and cannot be copied from the generated sounds dir.

    Returns the saved filename so the frontend can update the save payload.
    """
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    dest_dir = Path(SOUNDSCAPE_DATA_DIR) / model_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Build a safe filename from the sound_id
    safe_id = "".join(
        c if c.isalnum() or c in ("-", "_") else "_" for c in sound_id
    )
    # Preserve original extension if available, default to .wav
    ext = os.path.splitext(audio.filename or "")[1] or ".wav"
    filename = f"{safe_id}{ext}"

    dest = dest_dir / filename
    try:
        content = await audio.read()
        with open(dest, "wb") as f:
            f.write(content)
        logger.info(f"Uploaded audio for sound {sound_id}: {dest}")
    except Exception as e:
        logger.error(f"Failed to save uploaded audio {sound_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save audio: {e}")

    return {"filename": filename, "sound_id": sound_id}
