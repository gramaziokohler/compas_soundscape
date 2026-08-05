# backend/services/audio_service.py
# Audio Generation Service

import os
import torch
import torchaudio
from tangoflux import TangoFluxInference
from contextlib import contextmanager
from utils.audio_processing import (
    normalize_audio_rms,
    apply_dbfs_calibration,
    apply_denoising as denoise_audio,
    ensure_mono,
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
    DEFAULT_DBFS,
    GENERATED_SOUNDS_DIR,
    GENERATED_SOUND_URL_PREFIX,
    FORCE_CPU_MODE
)

# AudioLDM2 is imported lazily to make it optional


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
        version = None
        for pkg in ("tangoflux", "tango-flux", "TangoFlux"):
            try:
                version = importlib.metadata.version(pkg)
                break
            except importlib.metadata.PackageNotFoundError:
                continue
        if not version:
            try:
                import tangoflux as _tf
                version = getattr(_tf, "__version__", None) or getattr(_tf, "VERSION", None)
            except ImportError:
                pass
        device = (
            "cuda" if torch.cuda.is_available()
            else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            else "cpu"
        )
        return {"name": "TangoFlux", "version": version or "unknown", "device": device}

    def __init__(self):
        # Respect FORCE_CPU_MODE setting, otherwise use CUDA if available
        if FORCE_CPU_MODE:
            self.device = 'cpu'
            print("AudioService: Forced CPU mode (FORCE_CPU_MODE=true)")
        else:
            self.device = 'cuda' if torch.cuda.is_available() else 'mps' if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 'cpu'
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
        """Clear CUDA/MPS cache to free up GPU memory"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        elif hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache') and self.device == 'mps':
            torch.mps.empty_cache()

    def _init_audioldm2_service(self):
        """Lazy initialization of the AudioLDM2 service"""
        if self.audioldm2_service is None:
            print("Initializing AudioLDM2 service...")
            try:
                from services.audioldm2_service import AudioLDM2Service
                self.audioldm2_service = AudioLDM2Service()
            except ImportError as e:
                print(f"Warning: Failed to import AudioLDM2Service. Ensure dependencies are met. {e}")
                self.audioldm2_service = None
        return self.audioldm2_service

    def generate_sound_file(
        self,
        prompt: str,
        output_path: str,
        duration: int = DEFAULT_DURATION_SECONDS,
        guidance_scale: float = DEFAULT_GUIDANCE_SCALE,
        steps: int = DEFAULT_DIFFUSION_STEPS,
        dbfs: float = DEFAULT_DBFS,
        apply_denoising: bool = False,
        audio_model: str = DEFAULT_AUDIO_MODEL,
        negative_prompt: str = "",
        progress_callback: callable = None,
        stage_callback: callable = None,
    ) -> None:
        """Generate a single audio file from a text prompt with dBFS calibration and optional denoising

        Args:
            prompt: Text prompt for sound generation
            output_path: Path to save the generated audio
            duration: Duration in seconds
            guidance_scale: Guidance scale for generation
            steps: Number of diffusion steps
            dbfs: Target volume level in dBFS
            apply_denoising: Whether to apply noise reduction
            audio_model: Model to use ('tangoflux' or 'audioldm2')
            negative_prompt: Negative prompt (used by AudioLDM2)
            progress_callback: Callback(step, total) fired each diffusion step
            stage_callback: Callback(stage_str) fired at post-processing stages (denoising, calibration)
        """
        denoise_suffix = " + denoising" if apply_denoising else ""
        print(f"Generating sound with {audio_model}: {prompt} (Target level: {dbfs} dBFS{denoise_suffix})")

        # Route to appropriate model
        if audio_model == AUDIO_MODEL_AUDIOLDM2:
            # Use AudioLDM2 service
            audioldm2_service = self._init_audioldm2_service()
            if audioldm2_service is not None:
                audioldm2_service.generate_sound_file(
                    prompt=prompt,
                    output_path=output_path,
                    duration=duration,
                    guidance_scale=guidance_scale,
                    steps=steps,
                    dbfs=dbfs,
                    apply_denoising=apply_denoising,
                    negative_prompt=negative_prompt or "Low quality, distorted",
                    progress_callback=progress_callback,
                    stage_callback=stage_callback,
                )
            else:
                print("AudioLDM2 service is unavailable. Falling back to TangoFlux.")
                audio_model = AUDIO_MODEL_TANGOFLUX

        if audio_model != AUDIO_MODEL_AUDIOLDM2:
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
                if stage_callback:
                    stage_callback("Applying noise reduction...")
                print("Applying noise reduction...")
                audio = denoise_audio(audio, sample_rate=AUDIO_SAMPLE_RATE)

            # Step 3: Apply dBFS calibration
            if stage_callback:
                stage_callback(f"Calibrating to {dbfs} dBFS...")
            audio = apply_dbfs_calibration(audio, target_dbfs=dbfs)

            # Safety: ensure mono before writing
            if audio.shape[0] > 1:
                audio = audio.mean(dim=0, keepdim=True)

            torchaudio.save(output_path, audio.cpu(), AUDIO_SAMPLE_RATE)
            print(f"Saved to: {output_path} (calibrated to {dbfs} dBFS{denoise_suffix})")

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

        # Force mono — all generated sounds are mono, but reprocessing
        # may be called on files that were inadvertently saved as stereo.
        audio_np = ensure_mono(audio_np)
        
        if apply_denoising:
            # Apply denoising
            print(f"Applying denoising to: {file_path}")
            
            # Convert numpy to torch tensor (mono: (samples,) -> (1, samples))
            audio_tensor = torch.from_numpy(audio_np).unsqueeze(0)
            
            # Apply denoising
            audio_tensor = denoise_audio(audio_tensor, sample_rate=sample_rate)
            # Convert back to numpy
            audio_np = audio_tensor.squeeze().cpu().numpy()
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
        target_dbfs: float = DEFAULT_DBFS,
        apply_denoising: bool = False,
    ):
        """Normalize RMS, optionally denoise, then apply dBFS calibration to any audio file.

        Mirrors the post-processing pipeline used by TangoFlux/AudioLDM2 so that
        uploaded, library, catalog, sample, and ElevenLabs audio are treated
        identically to ML-generated audio.

        Args:
            input_path: Path to the source audio file (any format readable by soundfile)
            output_path: Path where the calibrated WAV will be saved
            target_dbfs: Target volume level in dBFS (default -18 dBFS)
            apply_denoising: Whether to apply spectral-gating denoising before calibration
        """
        import soundfile as sf

        audio_np, sample_rate = sf.read(input_path)

        # Force mono — merge channels if the source is stereo or multi-channel.
        audio_np = ensure_mono(audio_np)

        # (samples,) → (1, samples)
        audio_tensor = torch.from_numpy(audio_np).float().unsqueeze(0)

        # Step 1: Normalize to base RMS level
        audio_tensor = normalize_audio_rms(audio_tensor, target_rms=TARGET_RMS)

        # Step 2: Apply denoising if requested
        if apply_denoising:
            print("Applying denoising during calibration...")
            audio_tensor = denoise_audio(audio_tensor, sample_rate=sample_rate)

        # Step 3: Apply dBFS calibration
        audio_tensor = apply_dbfs_calibration(audio_tensor, target_dbfs=target_dbfs)

        torchaudio.save(output_path, audio_tensor.cpu(), sample_rate)
        print(f"Calibrated: {output_path} -> {target_dbfs} dBFS")

    @staticmethod
    def cleanup_generated_sounds(output_dir: str = GENERATED_SOUNDS_DIR):
        """Delete all generated sound files"""
        if os.path.exists(output_dir):
            for filename in os.listdir(output_dir):
                file_path = os.path.join(output_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            print("Generated sounds cleaned up")

