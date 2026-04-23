# backend/services/audio_service.py
# Audio Generation Service

import os
import torch
import torchaudio
from tangoflux import TangoFluxInference
import random
from contextlib import contextmanager
from utils.audio_processing import (
    normalize_audio_rms,
    apply_spl_calibration,
    apply_denoising as denoise_audio
)
from config.constants import (
    TANGOFLUX_MODEL_NAME,
    AUDIO_MODEL_TANGOFLUX,
    AUDIO_MODEL_AUDIOLDM2,
    DEFAULT_AUDIO_MODEL,
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
    GENERATED_SOUND_URL_PREFIX,
    FORCE_CPU_MODE
)
from services.audioldm2_service import AudioLDM2Service


@contextmanager
def _tangoflux_step_callback(tangoflux_model, callback, total_steps: int):
    """Patch noise_scheduler.step on the inner TangoFlux model to fire callback each diffusion step.

    TangoFlux's inference_flow creates a tqdm bar but never calls .update() on it —
    so patching tqdm is useless. scheduler.step() is called exactly once per step.
    """
    if callback is None or tangoflux_model is None:
        yield
        return

    scheduler = tangoflux_model.model.noise_scheduler
    orig_step = scheduler.step
    counter = [0]

    def _patched_step(*args, **kwargs):
        result = orig_step(*args, **kwargs)
        counter[0] += 1
        callback(counter[0], total_steps)
        return result

    scheduler.step = _patched_step
    try:
        yield
    finally:
        scheduler.step = orig_step


class AudioService:
    """Service for generating audio from text prompts using multiple models"""

    @staticmethod
    def get_service_version_info() -> dict:
        import importlib.metadata
        try:
            version = importlib.metadata.version("tangoflux")
        except importlib.metadata.PackageNotFoundError:
            try:
                import tangoflux
                version = getattr(tangoflux, "__version__", "unknown")
            except ImportError:
                version = "unknown"
        return {"name": "tangoflux", "version": version}

    def __init__(self):
        # Respect FORCE_CPU_MODE setting, otherwise use CUDA if available
        if FORCE_CPU_MODE:
            self.device = 'cpu'
            print("AudioService: Forced CPU mode (FORCE_CPU_MODE=true)")
        else:
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"AudioService using device: {self.device}")
        self.tangoflux_model = None
        self.audioldm2_service = None

    def _init_tangoflux_model(self):
        """Lazy initialization of the TangoFlux model"""
        if self.tangoflux_model is None:
            print("Initializing TangoFlux model...")
            self.tangoflux_model = TangoFluxInference(name=TANGOFLUX_MODEL_NAME, device=self.device)
        return self.tangoflux_model

    def _clear_cuda_cache(self):
        """Clear CUDA cache to free up GPU memory"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()

    def _init_audioldm2_service(self):
        """Lazy initialization of the AudioLDM2 service"""
        if self.audioldm2_service is None:
            print("Initializing AudioLDM2 service...")
            self.audioldm2_service = AudioLDM2Service()
        return self.audioldm2_service

    @staticmethod
    def get_random_position(idx: int, total_sounds: int, bounding_box: dict = None):
        """Return [0, 0, 0] — positioning is handled by camera-front placement in the frontend."""
        # Bounding-box and default-spacing placement removed.
        # The frontend (SoundSphereManager) places sounds in front of the camera.
        # if bounding_box and bounding_box.get('min') and bounding_box.get('max'):
        #     min_bounds = bounding_box['min']
        #     max_bounds = bounding_box['max']
        #     return [
        #         random.uniform(min_bounds[0], max_bounds[0]),
        #         random.uniform(min_bounds[1], max_bounds[1]),
        #         random.uniform(min_bounds[2], max_bounds[2])
        #     ]
        # else:
        #     return [
        #         (idx * DEFAULT_POSITION_SPACING) - total_sounds * DEFAULT_POSITION_OFFSET,
        #         DEFAULT_POSITION_Y,
        #         DEFAULT_POSITION_Z
        #     ]
        return [0, 0, 0]

    def generate_sound_file(
        self,
        prompt: str,
        output_path: str,
        duration: int = DEFAULT_DURATION_SECONDS,
        guidance_scale: float = DEFAULT_GUIDANCE_SCALE,
        steps: int = DEFAULT_DIFFUSION_STEPS,
        spl_db: float = DEFAULT_SPL_DB,
        apply_denoising: bool = False,
        audio_model: str = DEFAULT_AUDIO_MODEL,
        negative_prompt: str = "",
        progress_callback: callable = None,
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
            audio_model: Model to use ('tangoflux' or 'audioldm2')
            negative_prompt: Negative prompt (used by AudioLDM2)
        """
        denoise_suffix = " + denoising" if apply_denoising else ""
        print(f"Generating sound with {audio_model}: {prompt} (Target SPL: {spl_db} dB{denoise_suffix})")

        # Route to appropriate model
        if audio_model == AUDIO_MODEL_AUDIOLDM2:
            # Use AudioLDM2 service
            audioldm2_service = self._init_audioldm2_service()
            audioldm2_service.generate_sound_file(
                prompt=prompt,
                output_path=output_path,
                duration=duration,
                guidance_scale=guidance_scale,
                steps=steps,
                spl_db=spl_db,
                apply_denoising=apply_denoising,
                negative_prompt=negative_prompt or "Low quality, distorted",
                progress_callback=progress_callback,
            )
        else:
            # Use TangoFlux (default)
            model = self._init_tangoflux_model()

            try:
                # Clear CUDA cache before generation
                self._clear_cuda_cache()

                with _tangoflux_step_callback(model, progress_callback, steps):
                    audio = model.generate(
                        prompt,
                        steps=steps,
                        duration=duration,
                        guidance_scale=guidance_scale
                    )

                # Clear CUDA cache after generation
                self._clear_cuda_cache()

            except RuntimeError as e:
                if "out of memory" in str(e).lower():
                    print(f"CUDA OOM error detected. Retrying on CPU...")
                    # Free the GPU model
                    self.tangoflux_model = None
                    self._clear_cuda_cache()

                    # Reinitialize on CPU
                    original_device = self.device
                    self.device = 'cpu'
                    model = self._init_tangoflux_model()

                    # Generate on CPU
                    with _tangoflux_step_callback(model, progress_callback, steps):
                        audio = model.generate(
                            prompt,
                            steps=steps,
                            duration=duration,
                            guidance_scale=guidance_scale
                        )

                    # Restore original device preference for next generation
                    self.device = original_device
                else:
                    raise

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
        apply_denoising: bool = False,
        audio_model: str = DEFAULT_AUDIO_MODEL
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
            negative_prompt = sound_config.get('negative_prompt', '')  # Get negative prompt from config

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
                # Fallback: use the complete prompt
                display_name = prompt

            # Create a hash of all generation parameters for unique identification
            import hashlib
            param_string = f"{prompt}_{duration}_{guidance_scale}_{steps}_{apply_denoising}_{audio_model}"
            param_hash = hashlib.md5(param_string.encode()).hexdigest()[:PARAM_HASH_LENGTH]

            for copy_idx in range(seed_copies):
                filename = f"{short_prompt}_{param_hash}_copy{copy_idx}.wav"
                output_path = os.path.normpath(os.path.join(output_dir, filename))

                # Use entity position if available, otherwise generate random position
                entity = sound_config.get('entity')
                if entity and entity.get('position'):
                    position = entity['position']
                    entity_index = entity.get('index')  # Get entity index for linking
                else:
                    position = self.get_random_position(idx, len(sound_configs), bounding_box)
                    entity_index = None

                # Skip if file with exact same parameters already exists
                if os.path.exists(output_path):
                    print(f"Sound with identical parameters already exists, skipping: {filename}")
                    sound_data = {
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
                    }
                    if entity_index is not None:
                        sound_data["entity_index"] = entity_index
                    generated_files.append(sound_data)
                    continue

                print(f"Generating sound {idx + 1}/{len(sound_configs)} (copy {copy_idx + 1}/{seed_copies}): {prompt}")

                # Generate audio with SPL calibration and optional denoising
                self.generate_sound_file(
                    prompt=prompt,
                    output_path=output_path,
                    duration=duration,
                    guidance_scale=guidance_scale,
                    steps=steps,
                    spl_db=spl_db,
                    apply_denoising=apply_denoising,
                    audio_model=audio_model,
                    negative_prompt=negative_prompt
                )

                sound_data = {
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
                }
                if entity_index is not None:
                    sound_data["entity_index"] = entity_index
                generated_files.append(sound_data)

        # Clear CUDA cache after all generations
        self._clear_cuda_cache()

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

    def calibrate_audio_file(
        self,
        input_path: str,
        output_path: str,
        target_spl_db: float = DEFAULT_SPL_DB,
        apply_denoising: bool = False,
    ):
        """Normalize RMS, optionally denoise, then apply SPL calibration to any audio file.

        Mirrors the post-processing pipeline used by TangoFlux/AudioLDM2 so that
        uploaded, library, catalog, sample, and ElevenLabs audio are treated
        identically to ML-generated audio.

        Args:
            input_path: Path to the source audio file (any format readable by soundfile)
            output_path: Path where the calibrated WAV will be saved
            target_spl_db: Target SPL level in dB (default 70 dB)
            apply_denoising: Whether to apply spectral-gating denoising before calibration
        """
        import soundfile as sf

        audio_np, sample_rate = sf.read(input_path)

        # (samples,) → (1, samples) ; (samples, channels) → (channels, samples)
        if audio_np.ndim == 1:
            audio_tensor = torch.from_numpy(audio_np).float().unsqueeze(0)
        else:
            audio_tensor = torch.from_numpy(audio_np.T).float()

        # Step 1: Normalize to base RMS level
        audio_tensor = normalize_audio_rms(audio_tensor, target_rms=TARGET_RMS)

        # Step 2: Apply denoising if requested
        if apply_denoising:
            print("Applying denoising during calibration...")
            audio_tensor = denoise_audio(audio_tensor, sample_rate=sample_rate)

        # Step 3: Apply SPL calibration
        audio_tensor = apply_spl_calibration(audio_tensor, target_spl_db=target_spl_db)

        torchaudio.save(output_path, audio_tensor.cpu(), sample_rate)
        print(f"Calibrated: {output_path} → {target_spl_db} dB SPL")

    @staticmethod
    def cleanup_generated_sounds(output_dir: str = GENERATED_SOUNDS_DIR):
        """Delete all generated sound files"""
        if os.path.exists(output_dir):
            for filename in os.listdir(output_dir):
                file_path = os.path.join(output_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            print("Generated sounds cleaned up")

