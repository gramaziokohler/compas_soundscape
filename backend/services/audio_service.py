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
from config.constants import (
    TANGOFLUX_MODEL_NAME,
    DEFAULT_DURATION_SECONDS,
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_DIFFUSION_STEPS,
    DEFAULT_SEED_COPIES,
    DEFAULT_INTERVAL_BETWEEN_SOUNDS,
    DEFAULT_POSITION_SPACING,
    DEFAULT_POSITION_OFFSET,
    DEFAULT_POSITION_Y,
    DEFAULT_POSITION_Z,
    FILENAME_MAX_LENGTH,
    PARAM_HASH_LENGTH,
    DISPLAY_NAME_WORD_COUNT,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
    TARGET_RMS,
    AUDIO_SAMPLE_RATE,
    DEFAULT_SPL_DB,
    GENERATED_SOUNDS_DIR,
    GENERATED_SOUND_URL_PREFIX
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
            self.model = TangoFluxInference(name=TANGOFLUX_MODEL_NAME, device=self.device)
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
                (idx * DEFAULT_POSITION_SPACING) - total_sounds * DEFAULT_POSITION_OFFSET,
                DEFAULT_POSITION_Y,
                DEFAULT_POSITION_Z
            ]

    def generate_sound_file(
        self,
        prompt: str,
        output_path: str,
        duration: int = DEFAULT_DURATION_SECONDS,
        guidance_scale: float = DEFAULT_GUIDANCE_SCALE,
        steps: int = DEFAULT_DIFFUSION_STEPS,
        spl_db: float = DEFAULT_SPL_DB,
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
        audio = normalize_audio_rms(audio, target_rms=TARGET_RMS)

        # Step 2: Apply denoising if requested
        if apply_denoising:
            print("Applying noise reduction...")
            audio = denoise_audio(audio, sample_rate=AUDIO_SAMPLE_RATE)

        # Step 3: Apply SPL calibration
        audio = apply_spl_calibration(audio, target_spl_db=spl_db)

        torchaudio.save(output_path, audio.cpu(), AUDIO_SAMPLE_RATE)
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
            # Prefer duration_seconds from LLM output, fallback to duration, then default
            duration = sound_config.get('duration_seconds') or sound_config.get('duration', DEFAULT_DURATION_SECONDS)
            guidance_scale = sound_config.get('guidance_scale', DEFAULT_GUIDANCE_SCALE)
            seed_copies = sound_config.get('seed_copies', DEFAULT_SEED_COPIES)
            steps = sound_config.get('steps', DEFAULT_DIFFUSION_STEPS)
            spl_db = sound_config.get('spl_db', DEFAULT_SPL_DB)  # Get SPL from config
            interval_seconds = sound_config.get('interval_seconds', DEFAULT_INTERVAL_BETWEEN_SOUNDS)  # Get interval from config

            if not prompt:
                continue

            # Create shortened filename from prompt - sanitize all illegal characters
            short_prompt = prompt[:FILENAME_MAX_LENGTH]
            for char in WINDOWS_ILLEGAL_FILENAME_CHARS:
                short_prompt = short_prompt.replace(char, '_')
            short_prompt = short_prompt.replace(' ', '_')

            # Use display_name from config if provided by LLM, otherwise fallback
            display_name = sound_config.get('display_name')
            if not display_name:
                # Fallback: extract first N words
                words = prompt.split()[:DISPLAY_NAME_WORD_COUNT]
                display_name = ' '.join(words).title()

            # Create a hash of all generation parameters for unique identification
            import hashlib
            param_string = f"{prompt}_{duration}_{guidance_scale}_{steps}_{apply_denoising}"
            param_hash = hashlib.md5(param_string.encode()).hexdigest()[:PARAM_HASH_LENGTH]

            for copy_idx in range(seed_copies):
                filename = f"{short_prompt}_{param_hash}_copy{copy_idx}.wav"
                output_path = os.path.normpath(os.path.join(output_dir, filename))

                # Use entity position if available, otherwise generate random position
                entity = sound_config.get('entity')
                if entity and entity.get('position'):
                    position = entity['position']
                else:
                    position = self.get_random_position(idx, len(sound_configs), bounding_box)

                # Skip if file with exact same parameters already exists
                if os.path.exists(output_path):
                    print(f"Sound with identical parameters already exists, skipping: {filename}")
                    generated_files.append({
                        "id": f"generated_{idx}_{copy_idx}",
                        "prompt": prompt,
                        "prompt_index": idx,
                        "display_name": display_name,
                        "url": f"{GENERATED_SOUND_URL_PREFIX}/{filename}",
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
                    "url": f"{GENERATED_SOUND_URL_PREFIX}/{filename}",
                    "duration": duration,
                    "copy_index": copy_idx,
                    "total_copies": seed_copies,
                    "position": position,
                    "volume_db": spl_db,
                    "interval_seconds": interval_seconds
                })

        return generated_files

    def reprocess_audio_file(self, file_path: str, apply_denoising: bool):
        """Reprocess an existing audio file to add or remove denoising
        
        Args:
            file_path: Path to the audio file
            apply_denoising: Whether to apply denoising
        """
        import soundfile as sf
        import torch
        from utils.audio_processing import apply_denoising as denoise_audio
        
        # Read the existing audio file
        audio_np, sample_rate = sf.read(file_path)
        
        if apply_denoising:
            # Apply denoising
            print(f"Applying denoising to: {file_path}")
            
            # Convert numpy to torch tensor (handle mono/stereo)
            if audio_np.ndim == 1:
                # Mono: (samples,) -> (1, samples)
                audio_tensor = torch.from_numpy(audio_np).unsqueeze(0)
            else:
                # Stereo: (samples, channels) -> (channels, samples)
                audio_tensor = torch.from_numpy(audio_np.T)
            
            # Apply denoising
            audio_tensor = denoise_audio(audio_tensor, sample_rate=sample_rate)
            
            # Convert back to numpy
            audio_np = audio_tensor.squeeze().cpu().numpy()
            
            # If stereo, transpose back to (samples, channels)
            if audio_tensor.shape[0] > 1:
                audio_np = audio_np.T
        else:
            # To remove denoising, we would need the original file
            # Since we can't truly "remove" denoising from an already processed file,
            # we just log that the file is already in its current state
            print(f"File already processed: {file_path} (cannot reverse denoising)")
            return
        
        # Save the processed audio back to the same file
        sf.write(file_path, audio_np, sample_rate)
        print(f"Reprocessed: {file_path}")

    @staticmethod
    def cleanup_generated_sounds(output_dir: str = GENERATED_SOUNDS_DIR):
        """Delete all generated sound files"""
        if os.path.exists(output_dir):
            for filename in os.listdir(output_dir):
                file_path = os.path.join(output_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            print("Generated sounds cleaned up")

