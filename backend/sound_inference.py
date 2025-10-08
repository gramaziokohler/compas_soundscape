import torch
import torchaudio
from tangoflux import TangoFluxInference
import os
output_path = './static/sounds/output.wav'
os.makedirs('./static/sounds', exist_ok=True)

device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Using device: {device}")
if device == 'cuda':
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"CUDA Version: {torch.version.cuda}")
else:
    print("WARNING: Running on CPU - inference will be slow!")

print("Loading model...")
model = TangoFluxInference(name='declare-lab/TangoFlux', device=device)
print("Generating audio...")
audio = model.generate('Hammer slowly hitting the wooden table', steps=50, duration=5)
print("Audio generation complete!")

# Remove existing file if it exists
if os.path.exists(output_path):
    os.remove(output_path)

torchaudio.save(output_path, audio.cpu(), 44100)
print(f"Audio saved to: {os.path.abspath(output_path)}")