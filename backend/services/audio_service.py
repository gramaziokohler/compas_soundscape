# backend/services/audio_service.py
# Audio Generation Service

import os
import torch
import torchaudio
from tangoflux import TangoFluxInference
import random
from utils.audio_processing import (
    normalize_audio_rms,
    apply_spl_calibration,
    apply_denoising as denoise_audio
)


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
        guidance_scale: float = 4.5,
        steps: int = 25,
        spl_db: float = 70.0,
        apply_denoising: bool = False
    ) -> None:
        """Generate a single audio file from a text prompt with SPL calibration and optional denoising

        Args:
            prompt: Text prompt for sound generation
            output_path: Path to save the generated audio
            duration: Duration in seconds
            guidance_scale: Guidance scale for generation
            steps: Number of diffusion steps
            spl_db: Target SPL level in dB
            apply_denoising: Whether to apply noise reduction
        """
        model = self._init_model()

        denoise_suffix = " + denoising" if apply_denoising else ""
        print(f"Generating sound: {prompt} (Target SPL: {spl_db} dB{denoise_suffix})")

        audio = model.generate(
            prompt,
            steps=steps,
            duration=duration,
            guidance_scale=guidance_scale
        )

        # Step 1: Normalize to base RMS level
        audio = normalize_audio_rms(audio, target_rms=0.1)

        # Step 2: Apply denoising if requested
        if apply_denoising:
            print("Applying noise reduction...")
            audio = denoise_audio(audio, sample_rate=44100)

        # Step 3: Apply SPL calibration
        audio = apply_spl_calibration(audio, target_spl_db=spl_db)

        torchaudio.save(output_path, audio.cpu(), 44100)
        print(f"Saved to: {output_path} (calibrated to {spl_db} dB SPL{denoise_suffix})")

    def generate_multiple_sounds(
        self,
        sound_configs: list[dict],
        output_dir: str,
        bounding_box: dict = None,
        apply_denoising: bool = False
    ) -> list[dict]:
        """Generate multiple audio files from a list of sound configurations"""
        os.makedirs(output_dir, exist_ok=True)

        generated_files = []

        for idx, sound_config in enumerate(sound_configs):
            prompt = sound_config.get('prompt', '')
            duration = sound_config.get('duration', 5)
            guidance_scale = sound_config.get('guidance_scale', 4.5)
            seed_copies = sound_config.get('seed_copies', 1)
            steps = sound_config.get('steps', 25)
            spl_db = sound_config.get('spl_db', 70.0)  # Get SPL from config
            interval_seconds = sound_config.get('interval_seconds', 30.0)  # Get interval from config

            if not prompt:
                continue

            # Create shortened filename from prompt - sanitize all illegal characters
            # Windows illegal characters: < > : " / \ | ? *
            short_prompt = (prompt[:50]
                .replace(' ', '_')
                .replace('/', '_')
                .replace('\\', '_')
                .replace(':', '_')
                .replace('*', '_')
                .replace('?', '_')
                .replace('"', '_')
                .replace('<', '_')
                .replace('>', '_')
                .replace('|', '_'))

            # Use display_name from config if provided by LLM, otherwise fallback
            display_name = sound_config.get('display_name')
            if not display_name:
                # Fallback: extract first 3 words
                words = prompt.split()[:3]
                display_name = ' '.join(words).title()

            for copy_idx in range(seed_copies):
                filename = f"{short_prompt}_copy{copy_idx}.wav"
                output_path = os.path.normpath(os.path.join(output_dir, filename))

                # Use entity position if available, otherwise generate random position
                entity = sound_config.get('entity')
                if entity and entity.get('position'):
                    position = entity['position']
                else:
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
                        "position": position,
                        "volume_db": spl_db,
                        "interval_seconds": interval_seconds
                    })
                    continue

                print(f"Generating sound {idx + 1}/{len(sound_configs)} (copy {copy_idx + 1}/{seed_copies}): {prompt}")

                # Generate audio with SPL calibration and optional denoising
                self.generate_sound_file(prompt, output_path, duration, guidance_scale, steps, spl_db, apply_denoising)

                generated_files.append({
                    "id": f"generated_{idx}_{copy_idx}",
                    "prompt": prompt,
                    "prompt_index": idx,
                    "display_name": display_name,
                    "url": f"/static/sounds/generated/{filename}",
                    "duration": duration,
                    "copy_index": copy_idx,
                    "total_copies": seed_copies,
                    "position": position,
                    "volume_db": spl_db,
                    "interval_seconds": interval_seconds
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
