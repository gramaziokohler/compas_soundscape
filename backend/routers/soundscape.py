# backend/routers/soundscape.py
# Soundscape Data Persistence Endpoints (Local-First Save/Load + Optional Speckle)

import json
import os
import shutil
import logging
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request

from services.speckle_service import SpeckleService
from services.paths import (
    user_data_dir,
    user_audio_dir,
    user_model_dir,
)
from models.schemas import (
    SoundscapeSaveRequest,
    SoundscapeSaveResponse,
    SoundscapeLoadResponse,
    SoundscapeData,
)
from config.constants import (
    SOUNDSCAPE_DATA_DIR,
    SOUNDSCAPE_DATA_URL_PREFIX,
    IMPULSE_RESPONSE_DIR,
    PYROOMACOUSTICS_RIR_DIR,
    TEMP_SIMULATIONS_DIR,
    TEMP_ANALYSIS_DIR,
    BACKEND_DIR,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speckle/soundscape", tags=["soundscape"])

speckle_service = SpeckleService()

SOUNDSCAPE_JSON_FILENAME = "soundscape.json"


def _get_session_id(request: Request) -> str:
    sid = getattr(getattr(request, "state", None), "session_id", None)
    if not sid:
        raise HTTPException(status_code=400, detail="No session cookie")
    return sid


def _ensure_authenticated() -> None:
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


def _copy_audio_files(session_id: str, model_id: str, audio_urls: list[str]) -> int:
    """Copy audio files from generated-sounds dir to session-level audio dir."""
    dest_dir = user_audio_dir(session_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    generated_sounds_dir = Path(BACKEND_DIR / "temp" / "static" / "sounds" / "generated") / session_id

    copied = 0
    for url in audio_urls:
        filename = os.path.basename(url)
        if not filename:
            continue

        source = generated_sounds_dir / filename
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


def _copy_ir_files(session_id: str, model_id: str, ir_urls: list[str]) -> int:
    """Copy IR files from temp directories to model-linked ir_files dir."""
    dest_dir = user_model_dir(session_id, model_id) / "ir_files"
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for url in ir_urls:
        filename = os.path.basename(url)
        if not filename:
            continue

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


def _copy_results_json(session_id: str, model_id: str, simulation_id: str) -> bool:
    """Copy simulation results JSON to the model-linked soundscape folder."""
    source = Path(TEMP_SIMULATIONS_DIR) / f"simulation_{simulation_id}_results.json"
    if not source.exists():
        logger.debug(f"Results JSON not found: {source}")
        return False

    dest_dir = user_model_dir(session_id, model_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"simulation_{simulation_id}_results.json"

    try:
        shutil.copy2(str(source), str(dest))
        return True
    except Exception as e:
        logger.warning(f"Failed to copy results JSON: {e}")
        return False


def _copy_analysis_files(session_id: str, model_id: str, analysis_ids: list[str], scenario_ids: list[str]) -> int:
    """Copy analysis and scenario JSON files from temp/analysis/ to persistent storage."""
    analysis_dir = Path(TEMP_ANALYSIS_DIR)
    if not analysis_dir.exists():
        return 0

    dest_dir = user_model_dir(session_id, model_id) / "analysis"
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for aid in analysis_ids:
        source = analysis_dir / f"analysis_{aid}.json"
        if source.exists():
            try:
                shutil.copy2(str(source), str(dest_dir / source.name))
                copied += 1
            except Exception as e:
                logger.warning(f"Failed to copy analysis file {aid}: {e}")

    for sid in scenario_ids:
        source = analysis_dir / f"scenarios_{sid}.json"
        if source.exists():
            try:
                shutil.copy2(str(source), str(dest_dir / source.name))
                copied += 1
            except Exception as e:
                logger.warning(f"Failed to copy scenario file {sid}: {e}")

    return copied


def _restore_analysis_files(session_id: str, model_id: str) -> int:
    """Restore analysis JSON files from persistent storage back to temp/analysis/."""
    src_dir = user_model_dir(session_id, model_id) / "analysis"
    if not src_dir.exists():
        return 0

    dest_dir = Path(TEMP_ANALYSIS_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)

    restored = 0
    for json_file in src_dir.glob("*.json"):
        dest = dest_dir / json_file.name
        if not dest.exists():
            try:
                shutil.copy2(str(json_file), str(dest))
                restored += 1
            except Exception as e:
                logger.warning(f"Failed to restore analysis file {json_file.name}: {e}")

    if restored > 0:
        logger.info(f"Restored {restored} analysis files from session storage")

    return restored


@router.post("/save", response_model=SoundscapeSaveResponse)
async def save_soundscape(request: SoundscapeSaveRequest, req: Request):
    """
    Save soundscape data locally (primary) + optionally to Speckle (secondary).

    1. Create session-keyed paths under data/soundscapes/{sid}/
    2. Copy audio files to session-level audio dir
    3. Copy IR files to model-linked ir_files dir
    4. Write soundscape.json as primary source of truth
    5. Attempt Speckle write (non-blocking, failure doesn't fail the request)
    """
    session_id = _get_session_id(req)
    data = request.soundscape_data
    model_id = data.model_id

    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    if not data.created_at:
        data.created_at = datetime.now(timezone.utc).isoformat()

    # Create folders
    model_dir = user_model_dir(session_id, model_id)
    model_dir.mkdir(parents=True, exist_ok=True)

    # Copy audio files → session-level audio/
    audio_copied = _copy_audio_files(session_id, model_id, request.audio_urls)
    logger.info(f"Copied {audio_copied}/{len(request.audio_urls)} audio files")

    # Copy IR files → model-linked ir_files/
    ir_copied = _copy_ir_files(session_id, model_id, request.ir_urls)
    logger.info(f"Copied {ir_copied}/{len(request.ir_urls)} IR files")

    # Copy simulation results JSON files
    for sim_config in data.simulation_configs:
        if sim_config.current_simulation_id:
            _copy_results_json(session_id, model_id, sim_config.current_simulation_id)

    # Copy analysis JSON files if provided
    analysis_copied = 0
    if request.analysis_ids or request.scenario_ids:
        analysis_copied = _copy_analysis_files(session_id, model_id, request.analysis_ids, request.scenario_ids)
        logger.info(f"Copied {analysis_copied} analysis files")

    # Write local soundscape.json (PRIMARY source of truth)
    soundscape_dict = data.model_dump()
    json_path = model_dir / SOUNDSCAPE_JSON_FILENAME
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(soundscape_dict, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved soundscape.json to {json_path}")
    except Exception as e:
        logger.error(f"Failed to write soundscape.json: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save soundscape: {e}")

    # Attempt Speckle write (non-blocking secondary)
    speckle_object_id = None
    speckle_ok = True
    try:
        _ensure_authenticated()
        speckle_object_id = speckle_service.send_soundscape_data(
            model_id=model_id,
            soundscape_data=soundscape_dict,
        )
    except Exception as e:
        speckle_ok = False
        logger.warning(f"Speckle upload failed (local save succeeded): {e}")

    audio_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/audio"
    ir_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/{model_id}/ir_files"

    return SoundscapeSaveResponse(
        success=True,
        speckle_object_id=speckle_object_id,
        local_folder=str(model_dir),
        audio_files_copied=audio_copied,
        ir_files_copied=ir_copied,
        message=(
            f"Saved {len(data.sound_configs)} configs, "
            f"{len(data.sound_events)} events, "
            f"{audio_copied} audio files, "
            f"{ir_copied} IR files, "
            f"{len(data.simulation_configs)} simulations"
            + (f" (Speckle: {speckle_object_id})" if speckle_ok else " (Speckle upload failed)")
        ),
    )


@router.get("/{model_id}", response_model=SoundscapeLoadResponse)
async def load_soundscape(model_id: str, req: Request):
    """
    Load soundscape data for a model — local JSON first, Speckle fallback.

    Also restores IR files and analysis files from persistent storage back to temp.
    """
    session_id = _get_session_id(req)

    audio_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/audio"
    ir_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/{model_id}/ir_files"

    # Restore analysis files from persistent storage back to temp/analysis/
    _restore_analysis_files(session_id, model_id)

    # Restore IR files from persistent storage back to temp library
    ir_files_dir = user_model_dir(session_id, model_id) / "ir_files"
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

    # PRIMARY: Load from local session-keyed soundscape.json
    json_path = user_model_dir(session_id, model_id) / SOUNDSCAPE_JSON_FILENAME

    def _load_json(path: Path) -> SoundscapeData | None:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return SoundscapeData(**json.load(f))
        except Exception as e:
            logger.warning(f"Failed to parse soundscape.json at {path}: {e}")
            return None

    if json_path.exists():
        soundscape = _load_json(json_path)
        if soundscape:
            logger.info(f"Loaded soundscape from session path: {json_path}")
            return SoundscapeLoadResponse(
                soundscape_data=soundscape,
                audio_base_url=audio_base_url,
                ir_base_url=ir_base_url,
                found=True,
            )

    # FALLBACK: Try old flat path (pre-session-isolation saves)
    legacy_json = Path(SOUNDSCAPE_DATA_DIR) / model_id / SOUNDSCAPE_JSON_FILENAME
    if legacy_json.exists():
        soundscape = _load_json(legacy_json)
        if soundscape:
            logger.info(f"Loaded soundscape from legacy path: {legacy_json}")
            legacy_audio_base = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{model_id}"
            legacy_ir_base = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{model_id}/ir_files"
            return SoundscapeLoadResponse(
                soundscape_data=soundscape,
                audio_base_url=legacy_audio_base,
                ir_base_url=legacy_ir_base,
                found=True,
            )

    # FALLBACK: Try Speckle (for backward compat with old saves)
    try:
        _ensure_authenticated()
        speckle_data = speckle_service.get_soundscape_data(model_id)
        if speckle_data:
            soundscape = SoundscapeData(**speckle_data)
            logger.info("Loaded soundscape from Speckle (fallback)")
            return SoundscapeLoadResponse(
                soundscape_data=soundscape,
                audio_base_url=audio_base_url,
                ir_base_url=ir_base_url,
                found=True,
            )
    except Exception as e:
        logger.warning(f"Speckle soundscape lookup failed: {e}")

    return SoundscapeLoadResponse(
        soundscape_data=None,
        audio_base_url=audio_base_url,
        ir_base_url=ir_base_url,
        found=False,
    )


@router.post("/{model_id}/upload-audio")
async def upload_soundscape_audio(
    model_id: str,
    req: Request,
    sound_id: str = Form(...),
    audio: UploadFile = File(...),
):
    """
    Upload an audio file (from a blob URL) to the session-level audio dir.

    Used for library and uploaded sounds whose audio only exists as a
    browser blob URL and cannot be copied from the generated sounds dir.
    """
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    session_id = _get_session_id(req)
    dest_dir = user_audio_dir(session_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    safe_id = "".join(
        c if c.isalnum() or c in ("-", "_") else "_" for c in sound_id
    )
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
