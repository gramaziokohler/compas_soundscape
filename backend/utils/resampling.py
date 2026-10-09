"""
Single resampler for every backend service that writes audio.

Model/solver-native rates (TangoFlux, AudioLDM2, Stable Audio 3, Gemini TTS,
Choras DE, uploaded IRs) are converted to the master ``AUDIO_SAMPLE_RATE``
here and nowhere else.

Depends on numpy + scipy only, so it is importable from the isolated
compas-sa3 worker env and the Choras code (``utils.audio_processing`` pulls in
librosa and is not).
"""
from __future__ import annotations

from fractions import Fraction

import numpy as np

from config.constants import AUDIO_SAMPLE_RATE, RESAMPLE_MAX_DENOMINATOR


def resample_to(
    audio: np.ndarray,
    orig_sr: float,
    target_sr: int = AUDIO_SAMPLE_RATE,
    axis: int = -1,
) -> np.ndarray:
    """Polyphase-resample ``audio`` from ``orig_sr`` to ``target_sr`` along ``axis``.

    Integer rates are converted exactly (e.g. 44100 → 48000 = 160/147); a
    non-integer rate (solver ``1/dt``) is approximated by a rational with
    denominator ≤ ``RESAMPLE_MAX_DENOMINATOR``.

    Returns ``audio`` unchanged when the rates already match.
    """
    if orig_sr == target_sr:
        return audio

    from scipy.signal import resample_poly

    ratio = (Fraction(target_sr) / Fraction(orig_sr)).limit_denominator(RESAMPLE_MAX_DENOMINATOR)
    return resample_poly(audio, up=ratio.numerator, down=ratio.denominator, axis=axis)


def resample_tensor_to(audio, orig_sr: float, target_sr: int = AUDIO_SAMPLE_RATE):
    """Torch wrapper around :func:`resample_to` for ``(channels, samples)`` tensors.

    Returns a float32 CPU tensor (unchanged input when the rates already match).
    """
    if orig_sr == target_sr:
        return audio

    import torch

    resampled = resample_to(audio.detach().cpu().numpy(), orig_sr, target_sr, axis=-1)
    return torch.from_numpy(np.ascontiguousarray(resampled)).float()
