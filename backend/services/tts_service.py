"""
Gemini Text-to-Speech service.

Uses the Google genai SDK Interactions API to generate spoken audio from text
via the Gemini 3.8 TTS models (``gemini-3.8-flash-tts`` /
``gemini-3.8-flash-lite-tts``).

Gemini 3.8 TTS differs from the removed 2.5 / 3.1-preview TTS models:

* The transcript is read strictly word-for-word, so language/style hints are
  passed as structured config (``speech_config.language``) — never inline text.
* Unary requests return a complete WAV file (``audio/wav``, RIFF header) rather
  than raw PCM, so the returned bytes are written directly (no manual header).
"""
from __future__ import annotations

import base64
import os
import wave
from typing import Optional

from config.constants import (
    TTS_MODEL_NAME,
    TTS_SAMPLE_RATE,
    TTS_DEFAULT_VOICE,
    DEFAULT_TTS_MODEL,
)

try:
    import google.genai as genai
    GOOGLE_GENAI_AVAILABLE = True
except ImportError:
    GOOGLE_GENAI_AVAILABLE = False


class TTSService:
    def __init__(self):
        self._client = None
        self._init_error: Optional[str] = None

    def _check_available(self) -> bool:
        """Return True if the google-genai package is importable and an API key is set."""
        if not GOOGLE_GENAI_AVAILABLE:
            self._init_error = "google-genai package not installed"
            return False
        if not os.getenv("GOOGLE_API_KEY"):
            self._init_error = "GOOGLE_API_KEY environment variable not set"
            return False
        return True

    def generate_speech(
        self,
        text: str,
        output_path: str,
        voice_name: str = TTS_DEFAULT_VOICE,
        language: Optional[str] = None,
        model: str = DEFAULT_TTS_MODEL,
    ) -> tuple[str, float]:
        """
        Generate speech audio from text and save as WAV.

        A fresh genai.Client is created for every call.  Reusing the same
        client across multiple sequential TTS requests causes the Gemini model
        to accumulate internal state, leading to 400 / NoneType failures on
        all but the first request in a batch.

        Returns (output_path, duration_seconds) on success. duration_seconds is
        the REAL length of the generated clip (measured from the returned audio),
        not a placeholder — callers must not substitute a guessed/nominal value,
        since downstream parametric scheduling (bakeOrchestrateSchedule) relies
        on it to correctly space out dependent sounds/dialogue.
        """
        if not text.strip():
            raise ValueError("Text must not be empty")

        if not self._check_available():
            raise RuntimeError(f"Gemini client not available: {self._init_error}")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Fresh client per call — avoids Gemini TTS state accumulation.
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

        speech_config: dict = {"voice": voice_name}
        if language:
            # Gemini 3.8 TTS reads the transcript verbatim; the language/accent
            # hint must live in structured config, not in the input text.
            speech_config["language"] = language

        interaction = client.interactions.create(
            model=model or DEFAULT_TTS_MODEL,
            input=[{
                "type": "user_input",
                "content": [{"type": "text", "text": text}],
            }],
            response_format={
                "type": "audio",
                "mime_type": "audio/wav",
                "sample_rate": TTS_SAMPLE_RATE,
            },
            generation_config={"speech_config": [speech_config]},
        )

        status = getattr(interaction, "status", None)
        if status is not None and status != "completed":
            raise RuntimeError(
                f"Gemini TTS interaction {status}: {getattr(interaction, 'errors', None)}"
            )

        audio = getattr(interaction, "output_audio", None)
        if audio is None or not getattr(audio, "data", None):
            # Fallback for response shapes that nest audio under `outputs`.
            for out in (getattr(interaction, "outputs", None) or []):
                if getattr(out, "type", None) == "audio" and getattr(out, "data", None):
                    audio = out
                    break
        if audio is None or not getattr(audio, "data", None):
            raise RuntimeError("Gemini TTS returned no audio content")

        data = base64.b64decode(audio.data)
        mime_type = getattr(audio, "mime_type", None) or "audio/wav"
        duration_seconds = self._write_audio(output_path, data, mime_type)
        return output_path, duration_seconds

    @staticmethod
    def _write_audio(
        filename: str,
        data: bytes,
        mime_type: str,
        channels: int = 1,
        rate: int = TTS_SAMPLE_RATE,
        sample_width: int = 2,
    ) -> float:
        """Write returned audio bytes to ``filename`` and return its duration.

        Gemini 3.8 TTS unary responses are already a complete WAV file (RIFF
        header) — write them verbatim. Only raw PCM (``audio/l16``) is wrapped
        in a WAV header.
        """
        if mime_type == "audio/wav" or data[:4] == b"RIFF":
            with open(filename, "wb") as f:
                f.write(data)
            with wave.open(filename, "rb") as wf:
                return wf.getnframes() / float(wf.getframerate())
        # Raw PCM (L16) — wrap in a WAV header.
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(rate)
            wf.writeframes(data)
        num_frames = len(data) / (channels * sample_width)
        return num_frames / rate

    @staticmethod
    def get_service_version_info() -> dict:
        return {
            "name": "Gemini TTS",
            "version": TTS_MODEL_NAME,
            "key": "gemini-tts",
        }
