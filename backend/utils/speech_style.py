"""Speech delivery style → level band (stateless).

A TTS delivery style ("whispering", "shouting across the room") is sent to Gemini
as a turn-level ``speech_metadata.style``. Every TTS file is then calibrated to the
same loudness anchor, so the playback level is the only thing that makes a
whisper quieter than normal talk — this module maps a free-text style to the
level band it should play at (``SPEECH_STYLE_LEVELS`` in config/constants.py).
"""
from __future__ import annotations

from config.constants import (
    SPEECH_DBFS_DEFAULT,
    SPEECH_DBFS_MAX,
    SPEECH_DBFS_MIN,
    SPEECH_STYLE_LEVELS,
    TTS_STYLE_MAX_CHARS,
)


def clean_style(style: str | None) -> str:
    """A style instruction trimmed to one line of at most TTS_STYLE_MAX_CHARS."""
    text = " ".join((style or "").split())
    return text[:TTS_STYLE_MAX_CHARS]


def style_level(style: str | None) -> dict | None:
    """The SPEECH_STYLE_LEVELS row a style falls in, or None for a neutral delivery."""
    text = clean_style(style).lower()
    if not text:
        return None
    for row in SPEECH_STYLE_LEVELS:
        if any(keyword in text for keyword in row["keywords"]):
            return row
    return None


def speech_dbfs_band(style: str | None) -> tuple[float, float, float]:
    """(min, max, default) dBFS of a speech entry with this delivery style."""
    row = style_level(style)
    if row is None:
        return SPEECH_DBFS_MIN, SPEECH_DBFS_MAX, SPEECH_DBFS_DEFAULT
    return row["min"], row["max"], row["default"]


def proposed_speech_dbfs(style: str | None) -> float | None:
    """Level to propose for a speaker with this style, or None when it is neutral."""
    row = style_level(style)
    return row["default"] if row else None


def style_level_guidance() -> str:
    """Prompt text listing the level band of each delivery style."""
    parts = [f"{row['key']} ({row['min']:g} to {row['max']:g} dBFS)" for row in SPEECH_STYLE_LEVELS]
    return "speech with a delivery 'style' uses that style's band instead: " + ", ".join(parts)
