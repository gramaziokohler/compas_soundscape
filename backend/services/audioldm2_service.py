# backend/services/audioldm2_service.py
# AudioLDM2 Generation Service

import torch
import torchaudio
from diffusers import AudioLDM2Pipeline
from config.constants import (
    AUDIOLDM2_MODEL_NAME,
    AUDIOLDM2_INFERENCE_STEPS,
    AUDIOLDM2_NUM_WAVEFORMS,
    AUDIOLDM2_SAMPLE_RATE,
    AUDIO_SAMPLE_RATE,
    DEFAULT_DURATION_SECONDS,
    TARGET_RMS,
    DEFAULT_SPL_DB
)
from utils.audio_processing import (
    normalize_audio_rms,
    apply_spl_calibration,
    apply_denoising as denoise_audio
)


class AudioLDM2Service:
    """Service for generating audio using AudioLDM2 model"""

    @staticmethod
    def get_service_version_info() -> dict:
        import importlib.metadata
        try:
            version = importlib.metadata.version("diffusers")
        except importlib.metadata.PackageNotFoundError:
            try:
                import diffusers
                version = getattr(diffusers, "__version__", "unknown")
            except ImportError:
                version = "unknown"
        return {"name": "diffusers (AudioLDM2)", "version": version}

    def __init__(self):
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"AudioLDM2Service using device: {self.device}")
        self.model = None

    def _init_model(self):
        """Lazy initialization of the AudioLDM2 model"""
        if self.model is None:
            print(f"Loading AudioLDM2 model: {AUDIOLDM2_MODEL_NAME}")
            self.model = AudioLDM2Pipeline.from_pretrained(
                AUDIOLDM2_MODEL_NAME,
                torch_dtype=torch.float16 if self.device == 'cuda' else torch.float32
            )
            self.model = self.model.to(self.device)
            print("AudioLDM2 model loaded successfully")
        return self.model

    def generate_sound_file(
        self,
        prompt: str,
        output_path: str,
        duration: int = DEFAULT_DURATION_SECONDS,
        guidance_scale: float = 3.5,
        steps: int = AUDIOLDM2_INFERENCE_STEPS,
        spl_db: float = DEFAULT_SPL_DB,
        apply_denoising: bool = False,
        negative_prompt: str = "Low quality, distorted",
        progress_callback: callable = None
    ) -> None:
        """Generate a single audio file from a text prompt using AudioLDM2

        Args:
            prompt: Text prompt for sound generation
            output_path: Path to save the generated audio
            duration: Duration in seconds
            guidance_scale: Guidance scale for generation (AudioLDM2 uses lower values)
            steps: Number of inference steps
            spl_db: Target SPL level in dB
            apply_denoising: Whether to apply noise reduction
            negative_prompt: Negative prompt to avoid certain characteristics
            progress_callback: Callback function to update generation progress
        """
        model = self._init_model()

        denoise_suffix = " + denoising" if apply_denoising else ""
        print(f"Generating sound with AudioLDM2: {prompt} (Target SPL: {spl_db} dB{denoise_suffix})")

        # Set random seed for reproducibility
        generator = torch.Generator(self.device).manual_seed(0)

        def _step_cb(step, timestep, latents):
            if progress_callback:
                progress_callback(step + 1, steps)

        # Generate audio using AudioLDM2
        audio_result = model(
            prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=steps,
            audio_length_in_s=float(duration),
            num_waveforms_per_prompt=AUDIOLDM2_NUM_WAVEFORMS,
            generator=generator,
            callback=_step_cb if progress_callback else None,
            callback_steps=1,
        )

        # Extract audio tensor from result (shape: [batch, samples])
        audio = torch.from_numpy(audio_result.audios[0]).unsqueeze(0)  # Add channel dimension

        # Resample from AudioLDM2's sample rate (16kHz) to target sample rate (44.1kHz)
        if AUDIOLDM2_SAMPLE_RATE != AUDIO_SAMPLE_RATE:
            resampler = torchaudio.transforms.Resample(
                orig_freq=AUDIOLDM2_SAMPLE_RATE,
                new_freq=AUDIO_SAMPLE_RATE
            ).to(audio.device)
            audio = resampler(audio)

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
