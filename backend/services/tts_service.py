"""
Gemini Text-to-Speech service.

Uses the Google genai SDK to generate spoken audio from text prompts
via the Gemini TTS model (gemini-2.5-flash-preview-tts).
"""
from __future__ import annotations

import os
import sys
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
    from google.genai import types
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
        the REAL length of the generated clip (measured from the PCM data), not
        a placeholder — callers must not substitute a guessed/nominal value,
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

        if language:
            formatted_text = (
                f"Translate the following transcript to this language: {language}. And speak it aloud.\n"
                f"#### TRANSCRIPT\n"
                f"{text}"
            )
        else:
            formatted_text = text

        response = client.models.generate_content(
            model=model or DEFAULT_TTS_MODEL,
            contents=formatted_text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice_name,
                        )
                    )
                ),
            ),
        )

        candidates = response.candidates if response else []
        if not candidates:
            raise RuntimeError(
                "Gemini TTS returned no candidates (safety filter or quota error)"
            )
        content = candidates[0].content
        if content is None or not content.parts:
            finish = getattr(candidates[0], "finish_reason", "unknown")
            raise RuntimeError(
                f"Gemini TTS returned empty content (finish_reason={finish})"
            )
        data = content.parts[0].inline_data.data
        duration_seconds = self._write_wav(output_path, data)
        return output_path, duration_seconds

    @staticmethod
    def _write_wav(filename: str, pcm: bytes, channels: int = 1, rate: int = TTS_SAMPLE_RATE, sample_width: int = 2) -> float:
        """Write raw PCM as a WAV file and return its real duration in seconds."""
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(rate)
            wf.writeframes(pcm)
        num_frames = len(pcm) / (channels * sample_width)
        duration = num_frames / rate
        return duration

    @staticmethod
    def get_service_version_info() -> dict:
        return {
            "name": "Gemini TTS",
            "version": TTS_MODEL_NAME,
            "key": "gemini-tts",
        }
