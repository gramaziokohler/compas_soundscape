"""
BBC Sound Effects Library Search Service

Searches the BBC Sound Effects API directly (no local CSV required).
Downloads sounds as WAV files from the BBC media server.
"""

import re
import requests
import shutil
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Dict, Optional
from config.constants import (
    BBC_API_URL,
    BBC_API_HEADERS,
    BBC_API_BATCH_SIZE,
    BBC_API_MAX_OFFSET,
    BBC_API_REQUEST_DELAY,
    BBC_DOWNLOAD_URL_TEMPLATE,
    MACOSX_SYSTEM_FOLDER,
    MAX_SEARCH_RESULTS,
    MAX_FILENAME_LENGTH_SAFE,
)

import time


def _clean_filename(text: str) -> str:
    """Sanitize text for use in filenames."""
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', text)[:MAX_FILENAME_LENGTH_SAFE]


def _get_download_url(file_id: str) -> str:
    """Build the BBC download URL for a sound file."""
    return BBC_DOWNLOAD_URL_TEMPLATE.format(location=file_id)


def _format_duration(milliseconds: float) -> str:
    """Format duration from milliseconds to min'sec\" format."""
    try:
        total_seconds = float(milliseconds) / 1000.0
        minutes = int(total_seconds // 60)
        secs = int(total_seconds % 60)
        return f"{minutes}'{secs:02d}\""
    except (ValueError, TypeError):
        return "Unknown"


def _extract_category(item: dict) -> str:
    """Extract the primary category name from the API response."""
    categories = item.get('categories', [])
    if categories and isinstance(categories, list) and len(categories) > 0:
        return categories[0].get('className', 'Uncategorized').replace('_', ' ')
    return 'Uncategorized'


def search_sounds(prompt: str, max_results: int = MAX_SEARCH_RESULTS) -> List[Dict[str, str]]:
    """
    Search the BBC Sound Effects API for sounds matching the prompt.

    Args:
        prompt: Text query describing the desired sound
        max_results: Maximum number of results to return

    Returns:
        List of dicts with keys: location, description, category, duration, score
    """
    if not prompt or not prompt.strip():
        return []

    results: List[Dict[str, str]] = []
    offset = 0

    print(f"[BBC Library] Searching API for: {prompt}")

    while len(results) < max_results:
        remaining = max_results - len(results)
        current_size = min(BBC_API_BATCH_SIZE, remaining)

        payload = {
            "criteria": {
                "query": prompt,
                "from": offset,
                "size": current_size,
                "tags": None,
                "categories": None,
                "durations": None,
                "continents": None,
                "sortBy": None,
                "source": None,
                "habitat": None,
                "recordist": None,
            }
        }

        try:
            response = requests.post(BBC_API_URL, json=payload, headers=BBC_API_HEADERS)

            if response.status_code != 200:
                print(f"[BBC Library] API error: status {response.status_code}")
                break

            data = response.json()
            items = data.get('results', [])

            if not items:
                break

            for item in items:
                results.append({
                    'location': item.get('id', ''),
                    'description': item.get('description', 'No Description'),
                    'category': _extract_category(item),
                    'duration': _format_duration(item.get('duration', 0)),
                    'score': 100 - len(results),  # Rank by API order
                })

            print(f"[BBC Library] Fetched {len(items)} items (total: {len(results)})")

            if offset >= BBC_API_MAX_OFFSET:
                break

            offset += len(items)
            time.sleep(BBC_API_REQUEST_DELAY)

        except Exception as e:
            print(f"[BBC Library] Search error: {e}")
            break

    return results[:max_results]


def download_sound(location: str, output_path: Path) -> bool:
    """
    Download a sound file from the BBC library.

    Args:
        location: The BBC sound ID
        output_path: Path where the WAV file should be saved

    Returns:
        True if download successful, False otherwise
    """
    # Skip download if file already exists
    if output_path.exists() and output_path.stat().st_size > 0:
        print(f"[BBC Library] Already downloaded: {output_path}")
        return True

    url = _get_download_url(location)
    temp_zip_path = output_path.parent / f"{location}.zip.temp"

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        temp_path, _ = urllib.request.urlretrieve(url)
        shutil.move(temp_path, temp_zip_path)

        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            extracted = False
            for member in zip_ref.infolist():
                if member.is_dir() or member.filename.startswith(MACOSX_SYSTEM_FOLDER):
                    continue
                with zip_ref.open(member) as source, open(output_path, 'wb') as target:
                    shutil.copyfileobj(source, target)
                extracted = True
                break

            if not extracted:
                print(f"[BBC Library] No audio file found in ZIP for {location}")
                return False

        print(f"[BBC Library] Downloaded: {location} -> {output_path}")
        return True

    except zipfile.BadZipFile:
        print(f"[BBC Library] Invalid ZIP file for {location}")
        return False
    except urllib.error.URLError as e:
        print(f"[BBC Library] Download failed for {url}: {e}")
        return False
    except Exception as e:
        print(f"[BBC Library] Error processing {location}: {e}")
        return False
    finally:
        if temp_zip_path.exists():
            try:
                temp_zip_path.unlink()
            except OSError:
                pass
