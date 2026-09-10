from diffusers import AutoencoderOobleck
import torch
import json
from .model import TangoFlux, GenerationCancelled
from huggingface_hub import snapshot_download
from safetensors.torch import load_file

class TangoFluxInference:

    def __init__(
        self,
        name="declare-lab/TangoFlux",
        device="cuda" if torch.cuda.is_available() else ("mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"),
        dtype: str | None = None,
    ):

        self.vae = AutoencoderOobleck()

        paths = snapshot_download(repo_id=name)
        vae_weights = load_file("{}/vae.safetensors".format(paths))
        self.vae.load_state_dict(vae_weights)
        weights = load_file("{}/tangoflux.safetensors".format(paths))

        with open("{}/config.json".format(paths), "r") as f:
            config = json.load(f)
        self.model = TangoFlux(config)
        self.model.load_state_dict(weights, strict=False)

        torch_dtype = getattr(torch, dtype) if dtype else None
        if torch_dtype is not None:
            self.vae.to(device, dtype=torch_dtype)
            self.model.to(device, dtype=torch_dtype)
        else:
            self.vae.to(device)
            self.model.to(device)

    def generate(self, prompt, steps=25, duration=10, guidance_scale=4.5, should_stop=None):
        """should_stop: optional callable polled once per diffusion step for cooperative cancel.

        Raises GenerationCancelled (re-exported from .model) if should_stop() returns True.
        """
        with torch.no_grad():
            latents = self.model.inference_flow(
                prompt,
                duration=duration,
                num_inference_steps=steps,
                guidance_scale=guidance_scale,
                should_stop=should_stop,
            )

            wave = self.vae.decode(latents.transpose(2, 1)).sample.cpu()[0]
        waveform_end = int(duration * self.vae.config.sampling_rate)
        wave = wave[:, :waveform_end]
        # Oobleck VAE outputs stereo; average to mono
        if wave.shape[0] == 2:
            wave = wave.mean(dim=0, keepdim=True)
        return wave
