# backend/utils/audio_processing.py
# Audio Processing Utilities

import torch
import numpy as np
from config.constants import (
    AUDIO_RMS_EPSILON,
    CLIPPING_THRESHOLD,
    SPL_CLIPPING_THRESHOLD,
    DEFAULT_SPL_DB,
    DENOISING_REDUCTION_STRENGTH
)

try:
    import noisereduce as nr
    NOISEREDUCE_AVAILABLE = True
except ImportError:
    NOISEREDUCE_AVAILABLE = False
    print("Warning: noisereduce library not available. Denoising feature will be disabled.")


def trim_ir(ir_data: np.ndarray, threshold_fraction: float = 0.05) -> np.ndarray:
    """Trim an impulse response by removing trailing samples below a threshold.

    Finds the last sample whose absolute amplitude exceeds
    `threshold_fraction * peak_amplitude` and discards everything after it.

    Args:
        ir_data: NumPy array of shape (samples,) or (samples, channels).
        threshold_fraction: Fraction of the peak amplitude used as the
            cut-off threshold (default 0.05 = 5%).

    Returns:
        Trimmed NumPy array with the same number of dimensions.
    """
    if ir_data.size == 0:
        return ir_data

    # Compute the absolute envelope across all channels
    if ir_data.ndim == 2:
        envelope = np.max(np.abs(ir_data), axis=1)
    else:
        envelope = np.abs(ir_data)

    peak = np.max(envelope)
    if peak == 0:
        return ir_data

    threshold = threshold_fraction * peak
    # Find last sample above threshold
    indices_above = np.where(envelope > threshold)[0]
    if len(indices_above) == 0:
        return ir_data

    last_idx = indices_above[-1]
    return ir_data[: last_idx + 1]


def calculate_rms(audio_tensor: torch.Tensor) -> float:
    """Calculate RMS (Root Mean Square) level of audio signal

    Args:
        audio_tensor: Audio tensor of shape (channels, samples) or (samples,)

    Returns:
        RMS level as a float
    """
    # Convert to numpy for easier calculation
    audio_np = audio_tensor.cpu().numpy()

    # If stereo, average the channels
    if audio_np.ndim > 1:
        audio_np = np.mean(audio_np, axis=0)

    # Calculate RMS
    rms = np.sqrt(np.mean(audio_np ** 2))
    return float(rms)


def normalize_audio_rms(audio_tensor: torch.Tensor, target_rms: float = 0.1) -> torch.Tensor:
    """Normalize audio to a target RMS level

    Args:
        audio_tensor: Audio tensor of shape (channels, samples) or (samples,)
        target_rms: Target RMS level (default 0.1 for reasonable headroom)

    Returns:
        Normalized audio tensor
    """
    current_rms = calculate_rms(audio_tensor)

    # Avoid division by zero
    if current_rms < AUDIO_RMS_EPSILON:
        return audio_tensor

    # Calculate scaling factor
    scale_factor = target_rms / current_rms

    # Apply scaling
    normalized_audio = audio_tensor * scale_factor

    # Prevent clipping
    max_val = torch.max(torch.abs(normalized_audio))
    if max_val > CLIPPING_THRESHOLD:
        normalized_audio = normalized_audio * (CLIPPING_THRESHOLD / max_val)

    return normalized_audio


def apply_spl_calibration(audio_tensor: torch.Tensor, target_spl_db: float, base_spl_db: float = DEFAULT_SPL_DB) -> torch.Tensor:
    """Apply SPL calibration to audio based on desired dB level

    Args:
        audio_tensor: Normalized audio tensor
        target_spl_db: Target SPL level in dB (e.g., 85 for heavy traffic)
        base_spl_db: Base SPL reference level in dB (default 70)

    Returns:
        Calibrated audio tensor
    """
    # Calculate dB difference from base
    db_diff = target_spl_db - base_spl_db

    # Convert dB to linear scale
    # 20*log10(x) = db_diff => x = 10^(db_diff/20)
    scale_factor = 10.0 ** (db_diff / 20.0)

    # Apply scaling
    calibrated_audio = audio_tensor * scale_factor

    # Prevent clipping
    max_val = torch.max(torch.abs(calibrated_audio))
    if max_val > SPL_CLIPPING_THRESHOLD:
        calibrated_audio = calibrated_audio * (SPL_CLIPPING_THRESHOLD / max_val)

    return calibrated_audio


def apply_denoising(audio_tensor: torch.Tensor, sample_rate: int = 44100) -> torch.Tensor:
    """Apply noise reduction to audio using spectral gating

    Args:
        audio_tensor: Audio tensor of shape (channels, samples)
        sample_rate: Sample rate in Hz (default 44100)

    Returns:
        Denoised audio tensor
    """
    if not NOISEREDUCE_AVAILABLE:
        print("Warning: noisereduce not available, returning original audio")
        return audio_tensor

    try:
        # Store original device and dtype
        original_device = audio_tensor.device
        original_dtype = audio_tensor.dtype

        # Convert to numpy (float32)
        audio_np = audio_tensor.cpu().float().numpy()

        print(f"Denoising audio shape: {audio_np.shape}, dtype: {audio_np.dtype}")

        # Handle stereo/mono
        if audio_np.ndim > 1 and audio_np.shape[0] > 1:
            # Stereo: Process each channel separately
            denoised_channels = []
            for channel_idx in range(audio_np.shape[0]):
                channel_data = audio_np[channel_idx]
                try:
                    # Apply noise reduction using stationary noise reduction
                    denoised_channel = nr.reduce_noise(
                        y=channel_data,
                        sr=sample_rate,
                        stationary=True,
                        prop_decrease=DENOISING_REDUCTION_STRENGTH
                    )
                    denoised_channels.append(denoised_channel)
                except Exception as e:
                    print(f"Error denoising channel {channel_idx}: {e}")
                    denoised_channels.append(channel_data)  # Use original if fails
            denoised_audio = np.stack(denoised_channels)
        else:
            # Mono audio - ensure 1D array
            if audio_np.ndim > 1:
                audio_1d = audio_np.squeeze()
            else:
                audio_1d = audio_np

            # Apply noise reduction
            denoised_audio = nr.reduce_noise(
                y=audio_1d,
                sr=sample_rate,
                stationary=True,
                prop_decrease=DENOISING_REDUCTION_STRENGTH
            )

            # Restore original shape if needed
            if audio_np.ndim > 1:
                denoised_audio = denoised_audio.reshape(audio_np.shape)

        # Convert back to torch tensor with original dtype and device
        denoised_tensor = torch.from_numpy(denoised_audio).to(dtype=original_dtype, device=original_device)
        print(f"Denoising completed successfully")
        return denoised_tensor

    except Exception as e:
        print(f"Error during denoising: {e}")
        print(f"Returning original audio without denoising")
        import traceback
        traceback.print_exc()
        return audio_tensor
