"""
File Operations Utilities

Centralized file handling operations to eliminate code duplication.
Provides consistent file upload, sanitization, and cleanup functionality.
"""

import json
import os
import re
import time
import aiofiles
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator
from fastapi import UploadFile
from config.constants import (
    TEMP_UPLOADS_DIR, TEMP_PARENT_DIR, TEMP_LIBRARY_DIR, TEMP_SIMULATIONS_DIR,
    TEMP_STATIC_DIR, IMPULSE_RESPONSE_DIR, PYROOMACOUSTICS_RIR_DIR,
    CHORAS_RIR_DIR, CHORAS_TEMP_DIR, SOUNDSCAPE_DATA_DIR, GENERATED_SOUNDS_DIR,
    TEMP_JANITOR_MAX_AGE_H,
)


def sanitize_filename(filename: str) -> str:
    """
    Sanitize a filename by removing or replacing invalid characters.

    Ensures cross-platform compatibility by removing characters that are
    problematic on Windows, Linux, or macOS filesystems.

    Args:
        filename: The original filename to sanitize

    Returns:
        str: Sanitized filename safe for filesystem use

    Examples:
        >>> sanitize_filename("my file<name>.txt")
        'my_file_name_.txt'
        >>> sanitize_filename("data/file:name|test.csv")
        'data_file_name_test.csv'
    """
    # Replace path separators with underscores
    filename = filename.replace('/', '_').replace('\\', '_')

    # Remove invalid characters (Windows + common problematic chars)
    invalid_chars = r'[<>:"|?*\n\r\t]'
    filename = re.sub(invalid_chars, '', filename)

    # Trim whitespace and ensure non-empty
    filename = filename.strip()
    if not filename:
        filename = "unnamed_file"

    return filename


def ensure_directory(directory_path: str | Path) -> Path:
    """
    Ensure a directory exists, creating it if necessary.

    Args:
        directory_path: Path to the directory

    Returns:
        Path: The directory path as a Path object

    Raises:
        OSError: If directory cannot be created
    """
    path = Path(directory_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


@asynccontextmanager
async def handle_upload_file(
    file: UploadFile,
    temp_dir: str = TEMP_UPLOADS_DIR
) -> AsyncGenerator[Path, None]:
    """
    Async context manager for handling temporary uploaded files.

    Automatically creates the temp directory, saves the uploaded file,
    and cleans up after use. Use with 'async with' statement.

    Args:
        file: The uploaded file from FastAPI
        temp_dir: Directory to store temporary files (default: TEMP_UPLOADS_DIR)

    Yields:
        Path: Path to the temporary file

    Example:
        ```python
        async with handle_upload_file(file) as temp_path:
            result = await process_file(temp_path)
        # File is automatically cleaned up here
        ```

    Note:
        The file is deleted automatically when exiting the context,
        even if an exception occurs.
    """
    # Ensure temp directory exists
    ensure_directory(temp_dir)

    # Sanitize filename and create path
    safe_filename = sanitize_filename(file.filename or "upload")
    temp_path = Path(temp_dir) / safe_filename

    try:
        # Write uploaded file to disk asynchronously
        async with aiofiles.open(temp_path, 'wb') as buffer:
            content = await file.read()
            await buffer.write(content)

        # Yield the path for use
        yield temp_path

    finally:
        # Clean up: remove temp file if it exists
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError as e:
                # Log but don't raise - cleanup failure shouldn't break flow
                print(f"Warning: Failed to delete temp file {temp_path}: {e}")


def cleanup_temp_directory(directory_path: str | Path, pattern: str = "*") -> int:
    """
    Clean up files in a temporary directory matching a pattern.

    Args:
        directory_path: Path to the directory to clean
        pattern: Glob pattern for files to delete (default: "*" for all files)

    Returns:
        int: Number of files deleted

    Example:
        ```python
        # Delete all WAV files in temp directory
        deleted = cleanup_temp_directory(TEMP_UPLOADS_DIR, "*.wav")
        print(f"Deleted {deleted} WAV files")
        ```
    """
    path = Path(directory_path)
    if not path.exists():
        return 0

    deleted_count = 0
    for file_path in path.glob(pattern):
        if file_path.is_file():
            try:
                file_path.unlink()
                deleted_count += 1
            except OSError as e:
                print(f"Warning: Failed to delete {file_path}: {e}")

    return deleted_count


def get_safe_file_path(directory: str | Path, filename: str, extension: str = "") -> Path:
    """
    Generate a safe file path with sanitized filename.

    Args:
        directory: Directory where the file should be stored
        filename: Original filename (will be sanitized)
        extension: Optional file extension to add (include the dot, e.g., ".wav")

    Returns:
        Path: Complete file path with sanitized filename

    Example:
        ```python
        path = get_safe_file_path("downloads", "my sound?.wav")
        # Returns Path("downloads/my_sound_.wav")
        ```
    """
    safe_name = sanitize_filename(filename)

    # Add extension if provided and not already present
    if extension and not safe_name.endswith(extension):
        # Remove existing extension if present
        safe_name = os.path.splitext(safe_name)[0]
        safe_name += extension

    return Path(directory) / safe_name


def ensure_all_temp_directories() -> None:
    """Create all application directories if they don't exist."""
    dirs = [
        TEMP_UPLOADS_DIR, TEMP_LIBRARY_DIR, TEMP_SIMULATIONS_DIR,
        TEMP_STATIC_DIR, GENERATED_SOUNDS_DIR, IMPULSE_RESPONSE_DIR,
        PYROOMACOUSTICS_RIR_DIR, CHORAS_RIR_DIR, CHORAS_TEMP_DIR,
        SOUNDSCAPE_DATA_DIR,
    ]
    for d in dirs:
        ensure_directory(d)
    print(f"Ensured {len(dirs)} application directories exist.")


def list_saved_soundscape_models(session_id: str) -> dict[str, str]:
    """
    Map ``model_id -> last local soundscape save time`` for a workspace.

    Scans ``data/soundscapes/<session_id>/<model_id>/soundscape.json`` and uses
    the file's mtime as the "last saved by this workspace" time. This is the
    app's own save (SoundscapeStore autosave), intentionally distinct from
    Speckle's model ``updated_at`` (which any collaborator/commit can move).

    Returns:
        dict[str, str]: ``{model_id: ISO-8601 UTC timestamp}``. Empty when the
        workspace has never saved (or the directory does not exist).
    """
    root = Path(SOUNDSCAPE_DATA_DIR) / session_id
    saved: dict[str, str] = {}
    if not session_id or not root.is_dir():
        return saved

    for entry in root.iterdir():
        if not entry.is_dir() or entry.name == "audio":
            continue
        json_path = entry / "soundscape.json"
        if not json_path.is_file():
            continue
        try:
            mtime = json_path.stat().st_mtime
        except OSError:
            continue
        saved[entry.name] = datetime.fromtimestamp(
            mtime, tz=timezone.utc
        ).isoformat()

    return saved


# Local (non-Speckle) projects saved from the Home sandbox use this model_id prefix.
HOME_PROJECT_PREFIX = "home-"


def list_home_projects(session_id: str) -> list[dict]:
    """
    List saved Home ("sandbox") projects for a workspace.

    Home projects are stored like any other soundscape
    (``data/soundscapes/<session_id>/<model_id>/soundscape.json``) but use a
    ``home-`` model_id prefix. Returns newest first.
    """
    root = Path(SOUNDSCAPE_DATA_DIR) / session_id
    projects: list[dict] = []
    if not session_id or not root.is_dir():
        return projects

    for entry in root.iterdir():
        if not entry.is_dir() or not entry.name.startswith(HOME_PROJECT_PREFIX):
            continue
        json_path = entry / "soundscape.json"
        if not json_path.is_file():
            continue
        try:
            mtime = json_path.stat().st_mtime
            with open(json_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        projects.append(
            {
                "model_id": entry.name,
                "name": data.get("model_name") or entry.name,
                "saved_at": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
            }
        )

    projects.sort(key=lambda p: p["saved_at"], reverse=True)
    return projects


def janitor_cleanup_temp(max_age_h: float = TEMP_JANITOR_MAX_AGE_H) -> dict[str, int]:
    """
    Age-based janitor for `temp/` — the distributed-backend replacement for the
    boot-time temp wipe that used to run on every API start.

    Deleting everything at boot would destroy every user's live session audio
    and IRs on every redeploy. Instead this deletes files whose mtime is older
    than `max_age_h` (default 24 h) and then prunes directories that were
    emptied by that pass. It is intended to run periodically (hourly) from the
    API lifespan, NOT on every restart.

    Returns:
        dict[str, int]: {"files": <deleted>, "directories": <removed>}
    """
    parent_path = Path(TEMP_PARENT_DIR)
    if not parent_path.exists():
        return {"files": 0, "directories": 0}

    cutoff = time.time() - float(max_age_h) * 3600.0
    files_deleted = 0
    dirs_removed = 0

    for dirpath, _dirnames, filenames in os.walk(parent_path, topdown=False):
        for filename in filenames:
            file_path = Path(dirpath) / filename
            try:
                if file_path.stat().st_mtime < cutoff:
                    file_path.unlink()
                    files_deleted += 1
            except OSError:
                pass

        # Remove directories that this pass emptied (never the temp root).
        dir_path = Path(dirpath)
        if dir_path != parent_path:
            try:
                if not any(dir_path.iterdir()) and dir_path.stat().st_mtime < cutoff:
                    dir_path.rmdir()
                    dirs_removed += 1
            except OSError:
                pass

    # The janitor may have pruned emptied temp dirs that other code assumes
    # exist (e.g. temp/simulations for worker progress/result files). Recreate
    # the required set so a pruned dir never breaks a later write.
    if dirs_removed:
        ensure_all_temp_directories()

    if files_deleted or dirs_removed:
        print(f"Janitor: deleted {files_deleted} file(s) older than {max_age_h}h, "
              f"removed {dirs_removed} emptied directory/ies")
    return {"files": files_deleted, "directories": dirs_removed}
