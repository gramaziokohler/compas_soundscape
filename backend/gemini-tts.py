import os
from google import genai
from google.genai import types
from dotenv import load_dotenv, find_dotenv
import wave

_env_local = find_dotenv('.env.local', raise_error_if_not_found=False, usecwd=False)
_env = find_dotenv('.env', raise_error_if_not_found=False, usecwd=False)
if _env_local:
    load_dotenv(_env_local, override=True)
if _env:
    load_dotenv(_env)

# Set up the wave file to save the output:
def wave_file(filename, pcm, channels=1, rate=24000, sample_width=2):
   with wave.open(filename, "wb") as wf:
      wf.setnchannels(channels)
      wf.setsampwidth(sample_width)
      wf.setframerate(rate)
      wf.writeframes(pcm)

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

response = client.models.generate_content(
#    model="gemini-3.1-flash-tts-preview",
   model="gemini-2.5-flash-preview-tts",
   contents="Say cheerfully: Have a wonderful day!",
   config=types.GenerateContentConfig(
      response_modalities=["AUDIO"],
      speech_config=types.SpeechConfig(
         voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
               voice_name='Kore',
            )
         )
      ),
   )
)

data = response.candidates[0].content.parts[0].inline_data.data

file_name='out.wav'
wave_file(file_name, data) # Saves the file to current directory