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
from services.metadata_store import metadata_store, ROLE_OWNER, ROLE_EDITOR
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


def _require_role(request: Request, workspace_id: str, allowed: tuple[str, ...]) -> str | None:
    """Guard a mutating route by the caller's workspace role.

    Anonymous/legacy sessions have no user_hash; in that mode there is a single
    implicit owner (the cookie itself is the workspace), so the guard is a no-op.
    """
    user_hash = getattr(getattr(request, "state", None), "user_hash", None)
    if not user_hash:
        return None
    role = metadata_store.get_member_role(workspace_id, user_hash)
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient permission for this workspace")
    return role


@router.get("/home-projects")
async def list_home_projects_endpoint(request: Request):
    """List locally saved Home (sandbox) projects for this workspace."""
    from utils.file_operations import list_home_projects

    return {"projects": list_home_projects(_get_session_id(request))}


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

    return copied


def _collect_referenced_audio(data: SoundscapeData) -> list[str]:
    """Every audio filename a saved soundscape references.

    Covers both 3D sound events (`audio_filename`) and analysis audio-context
    sources (`persisted_audio_filename` nested anywhere in `analysis_state`).
    """
    filenames: list[str] = []

    for event in data.sound_events or []:
        name = (event.audio_filename or "").strip()
        if name:
            filenames.append(name)

    def _walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if (
                    key in ("audio_filename", "persisted_audio_filename")
                    and isinstance(value, str)
                    and value.strip()
                ):
                    filenames.append(value.strip())
                else:
                    _walk(value)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    if data.analysis_state:
        _walk(data.analysis_state)

    return filenames


def _recover_missing_audio(session_id: str, filenames: list[str]) -> list[str]:
    """Best-effort restore of referenced audio into the session audio dir.

    On load some events reference audio that never made it into the persistent
    `audio/` folder (e.g. the file was generated after the last autosave, or the
    save-time copy failed). The generated/temp copy may still exist (< janitor
    age) — copy it in so the served URL resolves instead of returning 404.

    Returns the filenames still missing after recovery.
    """
    if not filenames:
        return []

    dest_dir = user_audio_dir(session_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    missing: list[str] = []
    for filename in dict.fromkeys(filenames):
        dest = dest_dir / filename
        if dest.is_file():
            continue
        # _resolve_audio_source falls back to a basename search across every
        # generated dir, the tts dir, and every persisted data audio dir — so a
        # stale source path still finds the file wherever it currently lives.
        source = _resolve_audio_source(
            f"{STATIC_MOUNT_PATH}/sounds/generated/{session_id}/{filename}",
            session_id,
        )
        if source is None:
            missing.append(filename)
            continue
        try:
            if source.resolve() != dest.resolve():
                shutil.copy2(str(source), str(dest))
        except Exception as e:
            logger.warning(f"Failed to restore audio {filename}: {e}")
            missing.append(filename)

    return missing


def _drop_missing_audio_filenames(data: SoundscapeData, missing: list[str]) -> None:
    """Clear audio filename refs whose file is gone.

    The frontend only builds a URL when the filename is set, so clearing it
    prevents requests for files that do not exist (and the resulting 404s). The
    event/card keeps its position/timeline state — only the audio ref goes.
    """
    if not missing:
        return
    missing_set = set(missing)

    for event in data.sound_events or []:
        if (event.audio_filename or "").strip() in missing_set:
            event.audio_filename = ""

    def _drop(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if (
                    key in ("audio_filename", "persisted_audio_filename")
                    and isinstance(value, str)
                    and value.strip() in missing_set
                ):
                    node[key] = ""
                else:
                    _drop(value)
        elif isinstance(node, list):
            for item in node:
                _drop(item)

    if data.analysis_state:
        _drop(data.analysis_state)


def _model_referenced_audio(model_dir: Path) -> set[str]:
    """Audio filenames referenced by a model's saved soundscape.json."""
    json_path = model_dir / SOUNDSCAPE_JSON_FILENAME
    if not json_path.exists():
        return set()
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = SoundscapeData(**json.load(f))
    except Exception as e:
        logger.warning(f"Failed to read {json_path}: {e}")
        return set()
    return set(_collect_referenced_audio(data))


def _workspace_audio_referenced_by_others(workspace_id: str, exclude_model_id: str) -> set[str]:
    """Filenames referenced by every OTHER model in the workspace.

    Used so deleting one model's history never removes a file another model in
    the same (shared) workspace still needs.
    """
    root = user_data_dir(workspace_id)
    refs: set[str] = set()
    if not root.exists():
        return refs
    for child in root.iterdir():
        if not child.is_dir() or child.name == "audio" or child.name == exclude_model_id:
            continue
        refs |= _model_referenced_audio(child)
    return refs


def _collect_referenced_ir_filenames(data: SoundscapeData) -> set[str]:
    """IR library filenames referenced by a soundscape's simulated/imported IR mappings."""
    refs: set[str] = set()
    for sim_config in (data.simulation_configs or []):
        mapping = getattr(sim_config, "source_receiver_ir_mapping", None) or {}
        for receiver_map in mapping.values():
            for meta in (receiver_map or {}).values():
                filename = getattr(meta, "filename", None)
                if filename is None and isinstance(meta, dict):
                    filename = meta.get("filename")
                if filename:
                    refs.add(filename)
    return refs


def _model_referenced_irs(model_dir: Path) -> set[str]:
    """IR library filenames referenced by a model's saved soundscape.json."""
    json_path = model_dir / SOUNDSCAPE_JSON_FILENAME
    if not json_path.exists():
        return set()
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = SoundscapeData(**json.load(f))
    except Exception as e:
        logger.warning(f"Failed to read {json_path}: {e}")
        return set()
    return _collect_referenced_ir_filenames(data)


def _workspace_irs_referenced_by_others(workspace_id: str, exclude_model_id: str) -> set[str]:
    """IR filenames referenced by every OTHER model in the workspace.

    The shared IR library (IMPULSE_RESPONSE_DIR) is global, so deleting one
    model's history must not remove an IR another model in the workspace still
    references.
    """
    root = user_data_dir(workspace_id)
    refs: set[str] = set()
    if not root.exists():
        return refs
    for child in root.iterdir():
        if not child.is_dir() or child.name == "audio" or child.name == exclude_model_id:
            continue
        refs |= _model_referenced_irs(child)
    return refs


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
    _require_role(req, session_id, (ROLE_OWNER, ROLE_EDITOR))
    data = request.soundscape_data
    model_id = data.model_id

    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    # Persist project_id and version_id from the request payload so the
    # frontend can reconstruct the Speckle geometry viewer on reload without
    # needing the user to re-pick the model.
    data.project_id = data.project_id or ""
    data.version_id = data.version_id or ""

    if not data.created_at:
        data.created_at = datetime.now(timezone.utc).isoformat()

    # Optimistic concurrency: if the client sent the revision it last saw and
    # the workspace has moved on (another member saved), reject the write.
    workspace = metadata_store.get_workspace(session_id)
    current_revision = int(workspace["revision"]) if workspace else 0
    if request.base_revision is not None and request.base_revision != current_revision:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "This workspace changed since you last loaded it. Reload before saving.",
                "revision": current_revision,
            },
        )

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

    # Index the model → workspace so ?model_id= bootstrap can resolve the
    # workspace owner from any user, and bump the workspace revision
    # (optimistic-concurrency token for shared sessions).
    new_revision = current_revision
    try:
        metadata_store.link_model(model_id, session_id)
        new_revision = metadata_store.bump_revision(session_id)
    except Exception as e:  # metadata is best-effort; never fail the save
        logger.warning(f"Failed to update workspace metadata for {model_id}: {e}")

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
        revision=new_revision,
    )


@router.get("/{model_id}", response_model=SoundscapeLoadResponse)
async def load_soundscape(model_id: str, req: Request, workspace_id: str | None = None):
    """
    Load soundscape data for a model — local JSON.

    Also restores IR files and analysis files from persistent storage back to temp.
    """
    session_id = _get_session_id(req)
    user_hash = getattr(req.state, "user_hash", None)
    session_token = getattr(req.state, "session_token", None)

    # ── Resolve the workspace that owns this model ───────────────────────────
    # A user opening `?model_id=` may not have the model in their own workspace
    # yet (shared project). Resolve the owning workspace; members are switched to
    # it, link-shared workspaces auto-join, private non-member workspaces signal
    # `requires_invite`.
    requires_invite = False
    candidate_json = user_model_dir(session_id, model_id) / SOUNDSCAPE_JSON_FILENAME
    if not candidate_json.exists():
        owner_wid = metadata_store.resolve_model_workspace(model_id, prefer_workspace_id=workspace_id)
        if owner_wid and owner_wid != session_id:
            owner_ws = metadata_store.get_workspace(owner_wid)
            role = metadata_store.get_member_role(owner_wid, user_hash) if user_hash else None
            if role:
                session_id = owner_wid
                if session_token:
                    metadata_store.set_session_workspace(session_token, owner_wid)
                req.state.workspace_id = owner_wid
                req.state.session_id = owner_wid
            elif owner_ws and owner_ws.get("sharing_mode") == "link" and user_hash and session_token:
                metadata_store.ensure_member(owner_wid, user_hash, ROLE_EDITOR)
                metadata_store.set_session_workspace(session_token, owner_wid)
                session_id = owner_wid
                req.state.workspace_id = owner_wid
                req.state.session_id = owner_wid
            elif owner_ws and owner_ws.get("sharing_mode") == "private":
                requires_invite = True

    audio_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/audio"
    ir_base_url = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{session_id}/{model_id}/ir_files"
    workspace = metadata_store.get_workspace(session_id)
    revision = int(workspace["revision"]) if workspace else 0

    audio_dir = user_audio_dir(session_id)
    if audio_dir.exists():
        files = sorted(p.name for p in audio_dir.iterdir() if p.is_file())

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
            missing_audio = _recover_missing_audio(
                session_id, _collect_referenced_audio(soundscape)
            )
            if missing_audio:
                logger.warning(
                    f"{len(missing_audio)} referenced audio file(s) missing for model "
                    f"{model_id}: {missing_audio}"
                )
                _drop_missing_audio_filenames(soundscape, missing_audio)
            return SoundscapeLoadResponse(
                soundscape_data=soundscape,
                audio_base_url=audio_base_url,
                ir_base_url=ir_base_url,
                found=True,
                missing_audio_filenames=missing_audio,
                workspace_id=session_id,
                revision=revision,
                requires_invite=requires_invite,
            )

    # FALLBACK: Try old flat path (pre-session-isolation saves)
    legacy_json = Path(SOUNDSCAPE_DATA_DIR) / model_id / SOUNDSCAPE_JSON_FILENAME
    if legacy_json.exists():
        soundscape = _load_json(legacy_json)
        if soundscape:
            logger.info(f"Loaded soundscape from legacy path: {legacy_json}")
            # Legacy audio lives next to the model dir, not under <session>/audio.
            missing_audio = _recover_missing_audio(
                session_id, _collect_referenced_audio(soundscape)
            )
            if missing_audio:
                logger.warning(
                    f"{len(missing_audio)} referenced audio file(s) missing for legacy "
                    f"model {model_id}: {missing_audio}"
                )
                _drop_missing_audio_filenames(soundscape, missing_audio)
            legacy_audio_base = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{model_id}"
            legacy_ir_base = f"{SOUNDSCAPE_DATA_URL_PREFIX}/{model_id}/ir_files"
            return SoundscapeLoadResponse(
                soundscape_data=soundscape,
                audio_base_url=legacy_audio_base,
                ir_base_url=legacy_ir_base,
                found=True,
                missing_audio_filenames=missing_audio,
                workspace_id=session_id,
                revision=revision,
            )

    return SoundscapeLoadResponse(
        soundscape_data=None,
        audio_base_url=audio_base_url,
        ir_base_url=ir_base_url,
        found=False,
        workspace_id=session_id,
        revision=revision,
        requires_invite=requires_invite,
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
    _require_role(req, session_id, (ROLE_OWNER, ROLE_EDITOR))
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
    Delete ONE model's saved history from the current workspace.

    Removes only this model's directory (soundscape.json, ir_files, analysis,
    simulation results) and the audio files it references that no OTHER model in
    the workspace still needs. The workspace itself is left intact.
    """
    session_id = _get_session_id(req)
    _require_role(req, session_id, (ROLE_OWNER, ROLE_EDITOR))

    model_dir = user_model_dir(session_id, model_id)
    audio_dir = user_audio_dir(session_id)

    deleted_model = False
    deleted_audio = 0
    deleted_irs = 0

    if model_dir.exists():
        # Resolve this model's audio refs BEFORE removing its soundscape.json,
        # then only delete files no other model in the workspace references.
        model_refs = _model_referenced_audio(model_dir)
        shared_refs = _workspace_audio_referenced_by_others(session_id, model_id)
        for filename in model_refs - shared_refs:
            candidate = audio_dir / filename
            if candidate.is_file():
                try:
                    candidate.unlink()
                    deleted_audio += 1
                except OSError as e:
                    logger.warning(f"Failed to delete audio {filename}: {e}")

        # Resolve this model's IR refs before removing its soundscape.json, then
        # delete the shared-library copies no other model still references. The
        # per-model ir_files/ copies go away with the directory below.
        model_ir_refs = _model_referenced_irs(model_dir)
        shared_ir_refs = _workspace_irs_referenced_by_others(session_id, model_id)
        ir_library_dir = Path(IMPULSE_RESPONSE_DIR)
        for filename in model_ir_refs - shared_ir_refs:
            candidate = ir_library_dir / filename
            if candidate.is_file():
                try:
                    candidate.unlink()
                    deleted_irs += 1
                except OSError as e:
                    logger.warning(f"Failed to delete IR {filename}: {e}")

        shutil.rmtree(str(model_dir))
        deleted_model = True
        logger.info(f"Deleted model directory: {model_dir}")

    try:
        metadata_store.unlink_model(model_id)
        metadata_store.bump_revision(session_id)
    except Exception as e:
        logger.warning(f"Failed to update workspace metadata after delete: {e}")

    return {
        "success": True,
        "deleted_model": deleted_model,
        "deleted_audio_files": deleted_audio,
        "deleted_ir_files": deleted_irs,
    }


@router.delete("/workspace/{workspace_id}")
async def delete_workspace(workspace_id: str, req: Request):
    """
    Delete an entire workspace (all models + media). Owner-only.

    This is the destructive "delete the whole session/workspace" action, kept
    clearly separate from deleting a single model's history.
    """
    user_hash = getattr(req.state, "user_hash", None)
    if not user_hash:
        raise HTTPException(status_code=400, detail="No identity for this session")

    role = metadata_store.get_member_role(workspace_id, user_hash)
    if role != ROLE_OWNER:
        raise HTTPException(status_code=403, detail="Only the workspace owner can delete it")

    workspace_dir = user_data_dir(workspace_id)
    deleted = False
    if workspace_dir.exists():
        shutil.rmtree(str(workspace_dir))
        deleted = True
        logger.info(f"Deleted workspace directory: {workspace_dir}")

    # Remove the durable metadata too, and move every affected session to a
    # workspace its user still owns (otherwise they'd point at a ghost).
    try:
        affected = metadata_store.delete_workspace_rows(workspace_id)
        for uh in affected:
            user = metadata_store.get_user(uh) or {}
            name = f"{user.get('display_name') or 'My'}'s workspace"
            default_ws = metadata_store.get_or_create_default_workspace(uh, name)
            for sess in metadata_store.sessions_for_user(uh):
                metadata_store.set_workspace_for_token_hash(sess["token_hash"], default_ws["id"])
    except Exception as e:
        logger.warning(f"Failed to clean up workspace metadata for {workspace_id}: {e}")

    return {"success": True, "deleted_workspace": deleted}


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

    # Count only the audio files THIS model references (the workspace audio dir
    # is shared across models in a workspace).
    referenced_audio = _model_referenced_audio(model_dir) if json_path.exists() else set()
    audio_count = 0
    audio_bytes = 0
    for filename in referenced_audio:
        candidate = audio_dir / filename
        if candidate.is_file():
            audio_count += 1
            audio_bytes += candidate.stat().st_size
    audio_stats = {"count": audio_count, "total_bytes": audio_bytes}
    stats["audio_files"] = audio_count
    stats["audio_size_bytes"] = audio_bytes
    stats["audio_size_formatted"] = _format_bytes(audio_bytes)

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

    # Determine overall last modified time across the model dir + its audio files
    last_modified = 0.0
    if model_dir.exists():
        for f in model_dir.rglob("*"):
            if f.is_file():
                mtime = f.stat().st_mtime
                if mtime > last_modified:
                    last_modified = mtime
    for filename in referenced_audio:
        candidate = audio_dir / filename
        if candidate.is_file():
            mtime = candidate.stat().st_mtime
            if mtime > last_modified:
                last_modified = mtime
    stats["last_modified"] = (
        datetime.fromtimestamp(last_modified, tz=timezone.utc).isoformat()
        if last_modified > 0 else None
    )

    return stats
