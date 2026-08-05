# backend/routers/soundscape.py
# Soundscape Data Persistence Endpoints (Local-First Save/Load)

import json
import os
import shutil
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request

from services.paths import (
    GENERATED_SOUNDS_PARENT,
    user_audio_dir,
    user_data_dir,
    user_model_dir,
    user_sounds_dir,
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
    TEMP_STATIC_DIR,
    STATIC_MOUNT_PATH,
    BACKEND_DIR,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speckle/soundscape", tags=["soundscape"])

SOUNDSCAPE_JSON_FILENAME = "soundscape.json"


def _get_session_id(request: Request) -> str:
    sid = getattr(getattr(request, "state", None), "session_id", None)
    if not sid:
        raise HTTPException(status_code=400, detail="No session cookie")
    return sid


def _resolve_audio_source(url: str, session_id: str) -> Path | None:
    """Resolve an audio URL to an existing file on disk.

    Priority order:
      1. Direct URL-path mapping via the /static and /soundscapes mounts
         (handles already-persisted URLs, tts files, and current-session files).
      2. Basename search across the current session's generated dir, every other
         session's generated dir, the tts dir, every persisted session audio dir,
         and the staged uploads dir.
    """
    if not url or url.startswith("blob:"):
        return None

    # Normalize full URLs (http://host/path) to a URL path
    parsed = urlparse(url)
    url_path = parsed.path if parsed.scheme else url
    if not url_path:
        return None

    # 1. Direct mount mapping
    if url_path.startswith(STATIC_MOUNT_PATH + "/"):
        rel = unquote(url_path[len(STATIC_MOUNT_PATH):].lstrip("/"))
        if rel:
            candidate = Path(TEMP_STATIC_DIR) / rel
            if candidate.is_file():
                return candidate
    elif url_path.startswith(SOUNDSCAPE_DATA_URL_PREFIX + "/"):
        rel = unquote(url_path[len(SOUNDSCAPE_DATA_URL_PREFIX):].lstrip("/"))
        if rel:
            candidate = Path(SOUNDSCAPE_DATA_DIR) / rel
            if candidate.is_file():
                return candidate

    # 2. Basename fallback search (decode percent-encoding — TTS names can be encoded)
    filename = unquote(os.path.basename(url_path))
    if not filename:
        return None

    generated_parent = Path(GENERATED_SOUNDS_PARENT)

    candidates: list[Path] = [
        user_sounds_dir(session_id) / filename,
        generated_parent / "tts" / filename,
    ]
    if generated_parent.exists():
        candidates.extend(
            sub / filename
            for sub in generated_parent.iterdir()
            if sub.is_dir() and (sub / filename).is_file()
        )
    data_root = Path(SOUNDSCAPE_DATA_DIR)
    if data_root.exists():
        candidates.extend(
            sub / "audio" / filename
            for sub in data_root.iterdir()
            if sub.is_dir() and (sub / "audio" / filename).is_file()
        )

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _copy_audio_files(session_id: str, model_id: str, audio_urls: list[str]) -> int:
    """Copy audio files referenced by URLs into the session-level audio dir.

    Resolves each URL across all candidate locations (current session, other
    sessions, tts, already-persisted data/soundscapes) so sounds calibrated or
    generated under a different session cookie still land in the persistent
    `data/soundscapes/<session_id>/audio/` folder and survive a temp/ wipe.
    """
    dest_dir = user_audio_dir(session_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    print(f"[dbg:copy] session_id={session_id} n_urls={len(audio_urls)} dest={dest_dir}")

    copied = 0
    missing: list[str] = []
    for url in audio_urls:
        source = _resolve_audio_source(url, session_id)
        if source is None:
            logger.warning(f"Audio source not found for URL: {url}")
            missing.append(url)
            continue

        # Destination filename = decoded basename, matching what the /soundscapes
        # static mount will serve when the frontend reconstructs the URL.
        filename = unquote(os.path.basename(urlparse(url).path) or os.path.basename(url))
        if not filename:
            continue

        dest = dest_dir / filename
        try:
            if dest.resolve() != source.resolve():
                shutil.copy2(str(source), str(dest))
            copied += 1
        except Exception as e:
            logger.warning(f"Failed to copy {filename}: {e}")

    if missing:
        logger.warning(f"Missing audio sources ({len(missing)}): {missing}")
    print(f"[dbg:copy] copied={copied} missing={len(missing)}")

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
    Save soundscape data locally.

    1. Create session-keyed paths under data/soundscapes/{sid}/
    2. Copy audio files to session-level audio dir
    3. Copy IR files to model-linked ir_files dir
    4. Write soundscape.json as source of truth
    """
    session_id = _get_session_id(req)
    data = request.soundscape_data
    model_id = data.model_id

    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    print(f"[dbg:save] session_id={session_id} model_id={model_id} n_audio_urls={len(request.audio_urls)} n_ir_urls={len(request.ir_urls)}")
    print(f"[dbg:save] audio_urls={request.audio_urls}")

    # Persist project_id and version_id from the request payload so the
    # frontend can reconstruct the Speckle geometry viewer on reload without
    # needing the user to re-pick the model.
    data.project_id = data.project_id or ""
    data.version_id = data.version_id or ""

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

    audio_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/audio"
    ir_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/{model_id}/ir_files"

    return SoundscapeSaveResponse(
        success=True,
        local_folder=str(model_dir),
        audio_files_copied=audio_copied,
        ir_files_copied=ir_copied,
        message=(
            f"Saved {len(data.sound_configs)} configs, "
            f"{len(data.sound_events)} events, "
            f"{audio_copied} audio files, "
            f"{ir_copied} IR files, "
            f"{len(data.simulation_configs)} simulations"
        ),
    )


@router.get("/{model_id}", response_model=SoundscapeLoadResponse)
async def load_soundscape(model_id: str, req: Request):
    """
    Load soundscape data for a model — local JSON.

    Also restores IR files and analysis files from persistent storage back to temp.
    """
    session_id = _get_session_id(req)

    audio_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/audio"
    ir_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/{model_id}/ir_files"

    print(f"[dbg:load] session_id={session_id} model_id={model_id} audio_base_url={audio_base_url}")
    audio_dir = user_audio_dir(session_id)
    if audio_dir.exists():
        files = sorted(p.name for p in audio_dir.iterdir() if p.is_file())
        print(f"[dbg:load] audio_dir={audio_dir} files={files}")
    else:
        print(f"[dbg:load] audio_dir_MISSING={audio_dir}")

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


@router.delete("/{model_id}")
async def delete_soundscape(model_id: str, req: Request):
    """
    Delete a project's saved history.

    Removes the model-linked directory (soundscape.json, IR files, analysis files,
    simulation results) and the session-level audio directory for the current session.
    """
    session_id = _get_session_id(req)

    model_dir = user_model_dir(session_id, model_id)
    audio_dir = user_audio_dir(session_id)
    session_dir = user_data_dir(session_id)

    deleted_model = False
    deleted_audio = False

    if model_dir.exists():
        shutil.rmtree(str(model_dir))
        deleted_model = True
        logger.info(f"Deleted model directory: {model_dir}")

    if audio_dir.exists():
        shutil.rmtree(str(audio_dir))
        deleted_audio = True
        logger.info(f"Deleted session audio directory: {audio_dir}")

    # Remove session dir if empty after deletions
    if session_dir.exists():
        remaining = list(session_dir.iterdir())
        if len(remaining) == 0:
            shutil.rmtree(str(session_dir))
            logger.info(f"Removed empty session directory: {session_dir}")

    return {
        "success": True,
        "deleted_model": deleted_model,
        "deleted_audio": deleted_audio,
    }


def _format_bytes(size: int) -> str:
    """Format byte count as human-readable string."""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _get_dir_stats(directory: Path) -> dict:
    """Walk a directory and return file count, total bytes, last modified."""
    count = 0
    total_bytes = 0
    last_modified = 0.0
    if not directory.exists():
        return {"count": 0, "total_bytes": 0, "last_modified": None}
    for f in directory.rglob("*"):
        if f.is_file():
            count += 1
            total_bytes += f.stat().st_size
            mtime = f.stat().st_mtime
            if mtime > last_modified:
                last_modified = mtime
    return {
        "count": count,
        "total_bytes": total_bytes,
        "last_modified": datetime.fromtimestamp(last_modified, tz=timezone.utc).isoformat() if last_modified > 0 else None,
    }


@router.get("/{model_id}/stats")
async def get_soundscape_stats(model_id: str, req: Request):
    """
    Return file statistics for a saved soundscape.

    Reads soundscape.json for domain counts and walks the filesystem
    for IR, analysis, and simulation file sizes and dates.
    """
    session_id = _get_session_id(req)
    model_dir = user_model_dir(session_id, model_id)
    audio_dir = user_audio_dir(session_id)

    stats: dict = {
        "model_id": model_id,
        "found": False,
        "sound_configs": 0,
        "sound_events": 0,
        "receivers": 0,
        "simulation_configs": 0,
        "analysis_cards": 0,
        "audio_files": 0,
        "audio_size_bytes": 0,
        "audio_size_formatted": "0 B",
        "ir_files": 0,
        "ir_size_bytes": 0,
        "ir_size_formatted": "0 B",
        "analysis_files": 0,
        "simulation_result_files": 0,
        "total_size_bytes": 0,
        "total_size_formatted": "0 B",
        "last_modified": None,
        "created_at": None,
        "model_name": "",
    }

    # Read soundscape.json for domain counts
    json_path = model_dir / SOUNDSCAPE_JSON_FILENAME
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            stats["found"] = True
            stats["sound_configs"] = len(data.get("sound_configs", []))
            stats["sound_events"] = len(data.get("sound_events", []))
            stats["receivers"] = len(data.get("receivers", []))
            stats["simulation_configs"] = len(data.get("simulation_configs", []))
            analysis_state = data.get("analysis_state")
            if analysis_state:
                stats["analysis_cards"] = len(analysis_state.get("configs", []))
            stats["created_at"] = data.get("created_at") or None
            stats["model_name"] = data.get("model_name", "")
        except Exception:
            pass

    # Walk audio directory
    audio_stats = _get_dir_stats(audio_dir)
    stats["audio_files"] = audio_stats["count"]
    stats["audio_size_bytes"] = audio_stats["total_bytes"]
    stats["audio_size_formatted"] = _format_bytes(audio_stats["total_bytes"])

    # Walk IR files
    ir_dir = model_dir / "ir_files"
    ir_stats = _get_dir_stats(ir_dir)
    stats["ir_files"] = ir_stats["count"]
    stats["ir_size_bytes"] = ir_stats["total_bytes"]
    stats["ir_size_formatted"] = _format_bytes(ir_stats["total_bytes"])

    # Walk analysis files
    analysis_dir = model_dir / "analysis"
    stats["analysis_files"] = _get_dir_stats(analysis_dir)["count"]

    # Count simulation result files
    simulation_count = 0
    if model_dir.exists():
        for f in model_dir.glob("simulation_*_results.json"):
            if f.is_file():
                simulation_count += 1
    stats["simulation_result_files"] = simulation_count

    # Compute total size
    total_bytes = (
        audio_stats["total_bytes"] +
        ir_stats["total_bytes"] +
        (json_path.stat().st_size if json_path.exists() else 0)
    )
    # Add analysis file sizes
    if analysis_dir.exists():
        for f in analysis_dir.rglob("*.json"):
            if f.is_file():
                total_bytes += f.stat().st_size
    # Add simulation result sizes
    if model_dir.exists():
        for f in model_dir.glob("simulation_*_results.json"):
            if f.is_file():
                total_bytes += f.stat().st_size
    stats["total_size_bytes"] = total_bytes
    stats["total_size_formatted"] = _format_bytes(total_bytes)

    # Determine overall last modified time across all files in the model dir + audio dir
    last_modified = 0.0
    for directory in (model_dir, audio_dir):
        if directory.exists():
            for f in directory.rglob("*"):
                if f.is_file():
                    mtime = f.stat().st_mtime
                    if mtime > last_modified:
                        last_modified = mtime
    stats["last_modified"] = (
        datetime.fromtimestamp(last_modified, tz=timezone.utc).isoformat()
        if last_modified > 0 else None
    )

    return stats
