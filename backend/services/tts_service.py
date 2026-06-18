"""
Gemini Text-to-Speech service.

Uses the Google genai SDK to generate spoken audio from text prompts
via the Gemini TTS model (gemini-2.5-flash-preview-tts).
"""
from __future__ import annotations

import os
import wave
from typing import Optional

from config.constants import (
    TTS_MODEL_NAME,
    TTS_SAMPLE_RATE,
    TTS_DEFAULT_VOICE,
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

    def _init_client(self) -> bool:
        if self._client is not None:
            return True
        if not GOOGLE_GENAI_AVAILABLE:
            self._init_error = "google-genai package not installed"
            return False
        try:
            self._client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
            return True
        except Exception as e:
            self._init_error = str(e)
            return False

    def generate_speech(
        self,
        text: str,
        output_path: str,
        voice_name: str = TTS_DEFAULT_VOICE,
    ) -> str:
        """
        Generate speech audio from text and save as WAV.

        Returns the output_path on success.
        """
        if not text.strip():
            raise ValueError("Text must not be empty")

        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        if not self._init_client():
            raise RuntimeError(f"Gemini client not available: {self._init_error}")

        response = self._client.models.generate_content(
            model=TTS_MODEL_NAME,
            contents=text,
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

        data = response.candidates[0].content.parts[0].inline_data.data
        self._write_wav(output_path, data)
        return output_path

    @staticmethod
    def _write_wav(filename: str, pcm: bytes, channels: int = 1, rate: int = TTS_SAMPLE_RATE, sample_width: int = 2) -> None:
        with wave.open(filename, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(rate)
            wf.writeframes(pcm)

    @staticmethod
    def get_service_version_info() -> dict:
        return {
            "name": "Gemini TTS",
            "version": TTS_MODEL_NAME,
            "key": "gemini-tts",
        }
