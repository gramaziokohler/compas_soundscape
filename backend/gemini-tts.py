"""Standalone Gemini 3.8 TTS smoke script.

Run from backend/:  python gemini-tts.py
Writes out.wav (24 kHz mono WAV) in the current directory.
"""
import os
import base64

from google import genai
from dotenv import load_dotenv, find_dotenv

_env_local = find_dotenv('.env.local', raise_error_if_not_found=False, usecwd=False)
_env = find_dotenv('.env', raise_error_if_not_found=False, usecwd=False)
if _env_local:
    load_dotenv(_env_local, override=True)
if _env:
    load_dotenv(_env)

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

# Gemini 3.8 TTS uses the Interactions API. Unary requests return a complete
# WAV file, so the base64 payload is written directly (no manual WAV header).
interaction = client.interactions.create(
    model="gemini-3.8-flash-tts",
    input=[{
        "type": "user_input",
        "content": [{"type": "text", "text": "Say cheerfully: Have a wonderful day!"}],
    }],
    response_format={"type": "audio", "mime_type": "audio/wav", "sample_rate": 24000},
    generation_config={"speech_config": [{"voice": "Kore"}]},
)

with open("out.wav", "wb") as f:
    f.write(base64.b64decode(interaction.output_audio.data))
