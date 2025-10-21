"""
BBC Sound Effects Library Search Service

Provides API methods for searching and retrieving sounds from the BBC Sound Effects library.
Optimized for web API usage with minimal dependencies.
"""

import csv
import os
import urllib.request
import zipfile
import shutil
from pathlib import Path
from typing import List, Dict, Optional
from thefuzz import fuzz
from config.constants import (
    MAX_SEARCH_RESULTS,
    CATEGORY_WEIGHT,
    DESCRIPTION_WEIGHT,
    MIN_MATCH_SCORE_THRESHOLD,
    BBC_LIBRARY_CSV_PATH,
)


def format_duration(seconds_str: str) -> str:
    """
    Format duration from seconds to min'sec" format.

    Args:
        seconds_str: Duration in seconds as string (e.g., "125.5")

    Returns:
        Formatted duration string (e.g., "2'05\"")
    """
    try:
        total_seconds = float(seconds_str)
        minutes = int(total_seconds // 60)
        seconds = int(total_seconds % 60)
        return f"{minutes}'{seconds:02d}\""
    except (ValueError, TypeError):
        return "Unknown"


class BBCSoundLibrary:
    """
    BBC Sound Effects Library interface for searching and downloading sounds.

    Methods:
        search(prompt: str) -> List[Dict]: Search for sounds matching the prompt
        download_sound(location: str, output_path: Path) -> bool: Download a specific sound
    """

    def __init__(self, csv_path: str = BBC_LIBRARY_CSV_PATH):
        """
        Initialize the BBC Sound Library service.

        Args:
            csv_path: Path to the BBCSoundEffects.csv metadata file
        """
        self.csv_path = csv_path
        self.all_data = self._load_data()

    def _load_data(self) -> List[Dict[str, str]]:
        """
        Load sound effect metadata from CSV file.

        Returns:
            List of dictionaries containing sound metadata

        Raises:
            FileNotFoundError: If CSV file cannot be found
            ValueError: If CSV is missing required columns
        """
        data = []
        full_csv_path = None

        # Try multiple possible locations for the CSV
        script_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths = [
            os.path.join(script_dir, self.csv_path),
            os.path.abspath(self.csv_path),
            os.path.join(script_dir, '..', self.csv_path),  # One level up
        ]

        for path in possible_paths:
            if os.path.exists(path):
                full_csv_path = path
                break

        if not full_csv_path:
            raise FileNotFoundError(
                f"CSV file '{self.csv_path}' not found. Searched locations:\n" +
                "\n".join(f"  - {p}" for p in possible_paths)
            )

        # Load CSV data
        with open(full_csv_path, encoding='utf8', newline='') as f:
            reader = csv.DictReader(f)
            reader.fieldnames = [name.strip() for name in reader.fieldnames]

            # Validate required columns
            required_cols = {'location', 'description', 'category'}
            if not required_cols.issubset(reader.fieldnames):
                missing = required_cols - set(reader.fieldnames)
                raise ValueError(f"CSV is missing required columns: {missing}")

            # Load valid rows
            for row in reader:
                if not all([row.get('location'), row.get('description'), row.get('category')]):
                    continue
                row = {k.strip(): v.strip() for k, v in row.items()}
                data.append(row)

        if not data:
            raise ValueError("No valid data loaded from CSV file")

        print(f"[BBC Library] Loaded {len(data)} sound effects from {self.csv_path}")
        return data

    def search(self, prompt: str, max_results: int = MAX_SEARCH_RESULTS) -> List[Dict[str, str]]:
        """
        Search for sounds matching the given prompt using fuzzy matching.

        Args:
            prompt: Text query describing the desired sound
            max_results: Maximum number of results to return (default: 5)

        Returns:
            List of dictionaries with keys: location, description, category, duration, score
            Sorted by relevance (highest score first)
        """
        if not prompt or not prompt.strip():
            return []

        matches = []
        prompt_lower = prompt.lower()

        # Score each sound based on category and description match
        for item in self.all_data:
            category_lower = item.get('category', '').lower()
            description_lower = item.get('description', '').lower()

            # Calculate fuzzy match scores
            category_score = fuzz.token_set_ratio(prompt_lower, category_lower)
            description_score = fuzz.token_set_ratio(prompt_lower, description_lower)

            # Weighted total score
            total_score = (CATEGORY_WEIGHT * category_score) + (DESCRIPTION_WEIGHT * description_score)

            # Only include results above threshold
            if total_score >= MIN_MATCH_SCORE_THRESHOLD:
                # Format duration from 'secs' column
                raw_duration = item.get('secs', '')
                formatted_duration = format_duration(raw_duration) if raw_duration else 'Unknown'

                matches.append({
                    'location': item['location'],
                    'description': item['description'],
                    'category': item['category'],
                    'duration': formatted_duration,
                    'score': int(total_score)
                })

        # Sort by score (descending) and limit results
        matches.sort(key=lambda x: x['score'], reverse=True)
        return matches[:max_results]

    def download_sound(self, location: str, output_path: Path) -> bool:
        """
        Download a specific sound file from the BBC library.

        Args:
            location: The unique location identifier for the sound
            output_path: Path where the WAV file should be saved

        Returns:
            True if download successful, False otherwise
        """
        url = f'https://sound-effects-media.bbcrewind.co.uk/zip/{location}.zip'
        temp_zip_path = output_path.parent / f"{location}.zip.temp"

        try:
            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Download ZIP file
            temp_path, _ = urllib.request.urlretrieve(url)
            shutil.move(temp_path, temp_zip_path)

            # Extract WAV file from ZIP
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                extracted = False
                for member in zip_ref.infolist():
                    # Skip directories and system files
                    if member.is_dir() or member.filename.startswith('__MACOSX'):
                        continue

                    # Extract to output path
                    with zip_ref.open(member) as source, open(output_path, 'wb') as target:
                        shutil.copyfileobj(source, target)
                    extracted = True
                    break  # Only extract first audio file

                if not extracted:
                    print(f"[BBC Library] Warning: No audio file found in ZIP for {location}")
                    return False

            print(f"[BBC Library] Downloaded: {location} -> {output_path}")
            return True

        except zipfile.BadZipFile:
            print(f"[BBC Library] Error: Invalid ZIP file for {location}")
            return False
        except urllib.error.URLError as e:
            print(f"[BBC Library] Error: Failed to download {url}: {e}")
            return False
        except Exception as e:
            print(f"[BBC Library] Error: Failed to process {location}: {e}")
            return False
        finally:
            # Clean up temporary ZIP file
            if temp_zip_path.exists():
                try:
                    temp_zip_path.unlink()
                except OSError:
                    pass

    def get_sound_url(self, location: str) -> str:
        """
        Get the direct download URL for a sound.

        Args:
            location: The unique location identifier for the sound

        Returns:
            URL string for the sound's ZIP file
        """
        return f'https://sound-effects-media.bbcrewind.co.uk/zip/{location}.zip'


# Singleton instance for API usage
_library_instance: Optional[BBCSoundLibrary] = None


def get_library() -> BBCSoundLibrary:
    """
    Get the singleton BBC Sound Library instance.

    Returns:
        BBCSoundLibrary instance
    """
    global _library_instance
    if _library_instance is None:
        _library_instance = BBCSoundLibrary()
    return _library_instance


# API-friendly functions
def search_sounds(prompt: str, max_results: int = MAX_SEARCH_RESULTS) -> List[Dict[str, str]]:
    """
    API function: Search for sounds matching the prompt.

    Args:
        prompt: Text query describing the desired sound
        max_results: Maximum number of results (default: 5)

    Returns:
        List of sound metadata dictionaries
    """
    library = get_library()
    return library.search(prompt, max_results)


def download_sound_file(location: str, output_path: Path) -> bool:
    """
    API function: Download a sound file.

    Args:
        location: BBC library location identifier
        output_path: Where to save the WAV file

    Returns:
        True if successful, False otherwise
    """
    library = get_library()
    return library.download_sound(location, output_path)
