"""
Dialect-aware voice selection and custom (prompted) voice management for
Gemini 3.8 TTS.

* ``pick_voice`` maps a character's classic voice (Kore, Puck, …) to the voice
  that should actually speak for a resolved ``LanguageMatch``: a regional
  library voice of the same gender, the user's custom dialect voice, or the
  classic voice unchanged. The character name never changes — only the Gemini
  voice id — so the character ↔ voice naming system stays intact.
* ``create_prompted_voice`` / ``delete_remote_voice`` wrap
  ``client.voices.create/delete`` for user-created dialect voices.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from config.constants import (
    DEFAULT_TTS_MODEL,
    TTS_AVAILABLE_VOICES,
    TTS_CUSTOM_VOICE_DESCRIPTION_TEMPLATE,
    TTS_CUSTOM_VOICE_DISPLAY_NAME_MAX,
    TTS_CUSTOM_VOICE_TYPE,
    TTS_LANGUAGE_MATCH_CUSTOM,
)
from services.tts_voice_catalog import TTSVoiceCatalog
from utils.language_resolver import LanguageMatch

try:
    import google.genai as genai
    GOOGLE_GENAI_AVAILABLE = True
except ImportError:
    GOOGLE_GENAI_AVAILABLE = False

logger = logging.getLogger(__name__)


def default_voice_description(dialect: str) -> str:
    return TTS_CUSTOM_VOICE_DESCRIPTION_TEMPLATE.format(dialect=dialect)


def pick_voice(match: LanguageMatch, voice_name: str, catalog: TTSVoiceCatalog) -> str:
    """Gemini voice id to use for a character whose classic voice is ``voice_name``."""
    if match.kind == TTS_LANGUAGE_MATCH_CUSTOM and match.custom_voices:
        gender = catalog.gender_of(voice_name)
        same = [c for c in match.custom_voices if c.get("gender") == gender]
        return (same or match.custom_voices)[0]["gemini_voice_id"]

    if match.uses_classic_voices or not match.accent or not match.language_code:
        return voice_name

    gender = catalog.gender_of(voice_name)
    candidates = catalog.voices_for(match.accent, match.language_code, gender)
    if not candidates:
        return voice_name
    # Index of this classic voice among classic voices of the same gender →
    # distinct characters map to distinct regional voices (pool permitting),
    # and the mapping is stable across lines and sessions.
    same_gender_classics = [v for v in TTS_AVAILABLE_VOICES if catalog.gender_of(v) == gender]
    try:
        idx = same_gender_classics.index(voice_name)
    except ValueError:
        idx = 0
    return candidates[idx % len(candidates)]["id"]


def _client():
    if not GOOGLE_GENAI_AVAILABLE or not os.getenv("GOOGLE_API_KEY"):
        raise RuntimeError("Gemini client not available")
    return genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))


def create_prompted_voice(
    dialect: str,
    language_code: str,
    gender: str,
    description: str,
    model: str = DEFAULT_TTS_MODEL,
) -> dict:
    """Create a stored prompted voice. Blocking (~30 s). Returns
    ``{"gemini_voice_id", "expire_time"}``."""
    # Keep a reference for the whole call: a temporary genai.Client is closed
    # on garbage collection, aborting the in-flight request.
    client = _client()
    voice = client.voices.create(
        voice={
            "model": model,
            "type": TTS_CUSTOM_VOICE_TYPE,
            "display_name": f"{dialect} ({gender})"[:TTS_CUSTOM_VOICE_DISPLAY_NAME_MAX],
            "gender": gender,
            "language_code": language_code,
            "prompted": {"input": description},
        },
        store=True,
    )
    voice_id = getattr(voice, "id", None)
    if not voice_id:
        raise RuntimeError("Gemini returned no voice id")
    expire = getattr(voice, "expire_time", None)
    return {"gemini_voice_id": voice_id, "expire_time": str(expire) if expire else None}


def delete_remote_voice(gemini_voice_id: str) -> None:
    """Best-effort delete of a stored voice at Google (never raises)."""
    try:
        client = _client()
        client.voices.delete(gemini_voice_id)
    except Exception as exc:
        logger.warning("Could not delete Gemini voice %s: %s", gemini_voice_id, exc)
