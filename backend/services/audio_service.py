# backend/services/audio_service.py
# Audio Generation Service

import os
import torch
import torchaudio
from tangoflux import TangoFluxInference
import random


class AudioService:
    """Service for generating audio from text prompts"""

    def __init__(self):
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"Using device: {self.device}")
        self.model = None

    def _init_model(self):
        """Lazy initialization of the audio generation model"""
        if self.model is None:
            self.model = TangoFluxInference(name='declare-lab/TangoFlux', device=self.device)
        return self.model

    @staticmethod
    def get_random_position(idx: int, total_sounds: int, bounding_box: dict = None):
        """Generate random position within bounding box or default spacing"""
        if bounding_box and bounding_box.get('min') and bounding_box.get('max'):
            min_bounds = bounding_box['min']
            max_bounds = bounding_box['max']
            return [
                random.uniform(min_bounds[0], max_bounds[0]),
                random.uniform(min_bounds[1], max_bounds[1]),
                random.uniform(min_bounds[2], max_bounds[2])
            ]
        else:
            return [
                (idx * 3) - total_sounds * 1.5,
                1,
                0
            ]

    def generate_sound_file(
        self,
        prompt: str,
        output_path: str,
        duration: int = 5,
        guidance_scale: float = 4.5
    ) -> None:
        """Generate a single audio file from a text prompt"""
        model = self._init_model()

        print(f"Generating sound: {prompt}")

        audio = model.generate(
            prompt,
            steps=25,
            duration=duration,
            guidance_scale=guidance_scale
        )

        torchaudio.save(output_path, audio.cpu(), 44100)
        print(f"Saved to: {output_path}")

    def generate_multiple_sounds(
        self,
        sound_configs: list[dict],
        output_dir: str,
        bounding_box: dict = None
    ) -> list[dict]:
        """Generate multiple audio files from a list of sound configurations"""
        os.makedirs(output_dir, exist_ok=True)

        generated_files = []

        for idx, sound_config in enumerate(sound_configs):
            prompt = sound_config.get('prompt', '')
            duration = sound_config.get('duration', 5)
            guidance_scale = sound_config.get('guidance_scale', 4.5)
            seed_copies = sound_config.get('seed_copies', 1)

            if not prompt:
                continue

            # Create shortened filename from prompt
            short_prompt = prompt[:50].replace(' ', '_').replace('/', '_').replace('\\', '_').replace(':', '_')

            # Extract keywords for display name
            words = prompt.split()[:3]
            display_name = ' '.join(words).title()

            for copy_idx in range(seed_copies):
                filename = f"{short_prompt}_copy{copy_idx}.wav"
                output_path = os.path.join(output_dir, filename)

                # Generate position
                position = self.get_random_position(idx, len(sound_configs), bounding_box)

                # Skip if file already exists
                if os.path.exists(output_path):
                    print(f"Sound already exists, skipping: {filename}")
                    generated_files.append({
                        "id": f"generated_{idx}_{copy_idx}",
                        "prompt": prompt,
                        "prompt_index": idx,
                        "display_name": display_name,
                        "url": f"/static/sounds/generated/{filename}",
                        "duration": duration,
                        "copy_index": copy_idx,
                        "total_copies": seed_copies,
                        "position": position
                    })
                    continue

                print(f"Generating sound {idx + 1}/{len(sound_configs)} (copy {copy_idx + 1}/{seed_copies}): {prompt}")

                # Generate audio
                self.generate_sound_file(prompt, output_path, duration, guidance_scale)

                generated_files.append({
                    "id": f"generated_{idx}_{copy_idx}",
                    "prompt": prompt,
                    "prompt_index": idx,
                    "display_name": display_name,
                    "url": f"/static/sounds/generated/{filename}",
                    "duration": duration,
                    "copy_index": copy_idx,
                    "total_copies": seed_copies,
                    "position": position
                })

        return generated_files

    @staticmethod
    def cleanup_generated_sounds(output_dir: str = './static/sounds/generated'):
        """Delete all generated sound files"""
        if os.path.exists(output_dir):
            for filename in os.listdir(output_dir):
                file_path = os.path.join(output_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            print("Generated sounds cleaned up")
