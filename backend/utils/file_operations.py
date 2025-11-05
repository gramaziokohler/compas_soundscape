"""
File Operations Utilities

Centralized file handling operations to eliminate code duplication.
Provides consistent file upload, sanitization, and cleanup functionality.
"""

import os
import re
import aiofiles
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator
from fastapi import UploadFile
from config.constants import TEMP_UPLOADS_DIR, TEMP_LIBRARY_DIR, TEMP_DIR, IMPULSE_RESPONSE_DIR


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


def cleanup_all_temp_directories() -> dict[str, int]:
    """
    Clean up all temporary directories used by the application.

    This function should be called on application startup to ensure
    a clean state. It removes all files from temporary directories
    and the impulse response directory.

    Returns:
        dict[str, int]: Dictionary mapping directory paths to number of files deleted

    Example:
        ```python
        results = cleanup_all_temp_directories()
        print(f"Cleaned up {sum(results.values())} total files")
        ```
    """
    temp_directories = [TEMP_UPLOADS_DIR, TEMP_LIBRARY_DIR, TEMP_DIR, IMPULSE_RESPONSE_DIR]
    results = {}

    for temp_dir in temp_directories:
        try:
            deleted = cleanup_temp_directory(temp_dir)
            results[temp_dir] = deleted
            if deleted > 0:
                print(f"Cleaned up {deleted} file(s) from {temp_dir}")
        except Exception as e:
            print(f"Warning: Failed to cleanup {temp_dir}: {e}")
            results[temp_dir] = 0

    total_deleted = sum(results.values())
    if total_deleted > 0:
        print(f"Total: Cleaned up {total_deleted} temporary file(s)")
    else:
        print("No temporary files to clean up")

    return results
