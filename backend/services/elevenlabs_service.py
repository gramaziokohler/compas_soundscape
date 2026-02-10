# example.py
import os
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from elevenlabs.play import play

load_dotenv()

elevenlabs = ElevenLabs(
  api_key=os.getenv("ELEVENLABS_API_KEY"),
)
audio = elevenlabs.text_to_sound_effects.convert(text="wooden door closing")

play(audio)
