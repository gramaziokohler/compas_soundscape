# backend/utils/audio_processing.py
# Audio Processing Utilities

import torch
import numpy as np
import librosa
from config.constants import (
    AUDIO_RMS_EPSILON,
    CLIPPING_THRESHOLD,
    SPL_CLIPPING_THRESHOLD,
    DEFAULT_SPL_DB,
    DENOISING_REDUCTION_STRENGTH,
    DENOISING_NOISE_PROFILE_DURATION,
    DENOISING_NOISE_PROFILE_MIN_DURATION,
    DENOISING_NOISE_PROFILE_RATIO,
    DENOISING_MIN_PEAK_AMPLITUDE,
    DENOISING_ONSET_HOP_LENGTH,
    DENOISING_ONSET_PRE_MARGIN,
    DENOISING_TRIM_MERGE_THRESHOLD,
)

try:
    import noisereduce as nr
    NOISEREDUCE_AVAILABLE = True
except ImportError:
    NOISEREDUCE_AVAILABLE = False
    print("Warning: noisereduce library not available. Denoising feature will be disabled.")


def ensure_mono(audio_np: np.ndarray) -> np.ndarray:
    """Convert multi-channel audio to mono by averaging all channels.

    If the input is already mono (1-D), it is returned unchanged.
    For stereo or multi-channel input (shape ``samples × channels``),
    channels are averaged into a single 1-D array.

    Args:
        audio_np: NumPy array of shape ``(samples,)`` or ``(samples, channels)``.

    Returns:
        Mono audio as 1-D NumPy array of shape ``(samples,)``.
    """
    if audio_np.ndim == 1:
        return audio_np.copy()
    if audio_np.ndim == 2:
        return np.mean(audio_np, axis=1).astype(audio_np.dtype)
    raise ValueError(f"Unexpected audio array shape: {audio_np.shape}")


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


def _try_extract_noise_from_gap(
    channel_1d: np.ndarray,
    gap_start: int,
    gap_end: int,
    peak: float,
    desired_noise_samples: int,
    min_noise_samples: int,
) -> np.ndarray | None:
    """Try to extract a valid noise profile from a single silence gap.

    Windows of decreasing size (desired → half-desired → min) are scanned
    backward from *gap_end* (the silent side) so that SFX bleed near the
    previous onset is naturally avoided.
    """
    gap_duration = gap_end - gap_start
    for win_samples in (desired_noise_samples, desired_noise_samples // 2, min_noise_samples):
        if win_samples > gap_duration:
            continue
        # Scan backward from the silent end of the gap
        for offset in range(0, gap_duration - win_samples + 1, win_samples // 2):
            candidate_start = gap_end - win_samples - offset
            if candidate_start < gap_start:
                break
            noise_segment = channel_1d[candidate_start : candidate_start + win_samples]
            noise_rms = float(np.sqrt(np.mean(noise_segment ** 2)))
            if noise_rms < DENOISING_NOISE_PROFILE_RATIO * peak:
                return noise_segment
    return None


def _find_all_noise_gaps(
    channel_1d: np.ndarray, sample_rate: int
) -> tuple[list[tuple[int, int]], np.ndarray | None]:
    """Identify every background-noise gap and return the best noise profile.

    Uses spectral-flux onset detection to locate sound events, then tests the
    preamble and every inter-onset gap.  Returns all gap intervals that qualify
    as background noise, plus a noise-profile array extracted from the first
    valid gap (or ``None``).

    Args:
        channel_1d: 1-D numpy array (mono channel).
        sample_rate: Sample rate in Hz.

    Returns:
        ``(noise_gaps, noise_profile)`` — ``noise_gaps`` is a list of
        ``(start_sample, end_sample)`` tuples; ``noise_profile`` is a numpy
        array or ``None``.
    """
    peak = float(np.max(np.abs(channel_1d)))
    if peak < DENOISING_MIN_PEAK_AMPLITUDE:
        return [], None

    hop_samples = DENOISING_ONSET_HOP_LENGTH

    onsets = librosa.onset.onset_detect(
        y=channel_1d,
        sr=sample_rate,
        hop_length=hop_samples,
        backtrack=True,
    )

    if len(onsets) == 0:
        return [], None

    margin_samples = int(DENOISING_ONSET_PRE_MARGIN * sample_rate)
    desired_noise_samples = int(DENOISING_NOISE_PROFILE_DURATION * sample_rate)
    min_noise_samples = int(DENOISING_NOISE_PROFILE_MIN_DURATION * sample_rate)

    onset_samples = [int(frame) * hop_samples for frame in onsets]

    # Build all candidate silence gaps
    gaps = []
    preamble_end = onset_samples[0] - margin_samples
    if preamble_end >= min_noise_samples:
        gaps.append((0, preamble_end))
    for i in range(1, len(onsets)):
        gap_start = onset_samples[i - 1] + margin_samples
        gap_end = onset_samples[i] - margin_samples
        if gap_end - gap_start >= min_noise_samples:
            gaps.append((gap_start, gap_end))

    noise_gaps = []
    noise_profile = None

    for gs, ge in gaps:
        profile = _try_extract_noise_from_gap(
            channel_1d, gs, ge, peak, desired_noise_samples, min_noise_samples
        )
        if profile is not None:
            noise_gaps.append((gs, ge))
            if noise_profile is None:
                noise_profile = profile

    return noise_gaps, noise_profile


def _trim_to_longest_sfx_region(
    audio_1d: np.ndarray,
    noise_gaps: list[tuple[int, int]],
    merge_threshold_samples: int,
) -> np.ndarray:
    """Keep only the longest continuous SFX region after removing noise gaps.

    Noise gaps shorter than *merge_threshold_samples* are treated as part of
    the surrounding SFX (short pauses are not real separators).
    """
    # Only gaps at least as long as the merge threshold actually separate regions
    significant = [(s, e) for s, e in noise_gaps if e - s >= merge_threshold_samples]

    keep_regions = []
    cursor = 0
    for gs, ge in sorted(significant):
        if gs > cursor:
            keep_regions.append((cursor, gs))
        cursor = ge
    if cursor < len(audio_1d):
        keep_regions.append((cursor, len(audio_1d)))

    if not keep_regions:
        return audio_1d

    longest = max(keep_regions, key=lambda r: r[1] - r[0])
    return audio_1d[longest[0] : longest[1]]


def _get_channel_noise_profile(
    channel_1d: np.ndarray, sample_rate: int
) -> tuple[np.ndarray | None, int | None]:
    """Extract a noise profile and locate the first SFX onset (thin wrapper).

    See :func:`_find_all_noise_gaps` for details.
    """
    noise_gaps, noise_profile = _find_all_noise_gaps(channel_1d, sample_rate)
    first_onset = None
    if noise_gaps:
        # The first onset lies right after the first noise gap's end
        first_onset = noise_gaps[0][1] + int(DENOISING_ONSET_PRE_MARGIN * sample_rate)
    return noise_profile, first_onset


def apply_denoising(
    audio_tensor: torch.Tensor,
    sample_rate: int = 44100,
    trim_silence: bool = False,
) -> torch.Tensor:
    """Apply noise reduction to audio using spectral gating.

    Automatically detects background-noise segments via onset detection.
    If found, a noise profile is passed to the algorithm.
    If ``trim_silence`` is ``True``, *all* noise gaps are stripped and only the
    longest continuous SFX region is kept (short gaps ≤
    ``DENOISING_TRIM_MERGE_THRESHOLD`` seconds are merged).
    If no usable noise profile can be extracted the audio is returned unchanged.

    Args:
        audio_tensor: Audio tensor of shape (channels, samples).
        sample_rate: Sample rate in Hz (default 44100).
        trim_silence: If ``True``, remove all noise gaps and keep only the
            longest contiguous SFX portion.

    Returns:
        Denoised audio tensor (possibly trimmed).
    """
    if not NOISEREDUCE_AVAILABLE:
        print("Warning: noisereduce not available, returning original audio")
        return audio_tensor

    try:
        original_device = audio_tensor.device
        original_dtype = audio_tensor.dtype

        audio_np = audio_tensor.cpu().float().numpy()

        print(f"Denoising audio shape: {audio_np.shape}, dtype: {audio_np.dtype}")

        if audio_np.ndim > 1 and audio_np.shape[0] > 1:
            # Stereo: Process each channel separately
            merge_samples = int(DENOISING_TRIM_MERGE_THRESHOLD * sample_rate)
            denoised_channels = []
            for channel_idx in range(audio_np.shape[0]):
                channel_data = audio_np[channel_idx]
                try:
                    noise_gaps, noise_profile = _find_all_noise_gaps(
                        channel_data, sample_rate
                    )
                    if noise_profile is not None:
                        print(
                            f"Channel {channel_idx}: noise profile ({len(noise_profile)} samples), "
                            f"{len(noise_gaps)} noise gap(s)"
                        )
                        if trim_silence:
                            channel_data = _trim_to_longest_sfx_region(
                                channel_data, noise_gaps, merge_samples
                            )
                            print(
                                f"Channel {channel_idx}: kept longest SFX region "
                                f"({len(channel_data)} samples)"
                            )
                        denoised_channel = nr.reduce_noise(
                            y=channel_data,
                            sr=sample_rate,
                            y_noise=noise_profile,
                            prop_decrease=DENOISING_REDUCTION_STRENGTH,
                        )
                    else:
                        print(f"Channel {channel_idx}: no noise profile found, returning original")
                        denoised_channel = channel_data
                    denoised_channels.append(denoised_channel)
                except Exception as e:
                    print(f"Error denoising channel {channel_idx}: {e}")
                    denoised_channels.append(channel_data)
            denoised_audio = np.stack(denoised_channels)
        else:
            # Mono-like audio — ensure 1D
            was_multidim = audio_np.ndim > 1
            if was_multidim:
                audio_1d = audio_np.squeeze()
            else:
                audio_1d = audio_np

            noise_gaps, noise_profile = _find_all_noise_gaps(
                audio_1d, sample_rate
            )
            if noise_profile is not None:
                print(
                    f"Noise profile ({len(noise_profile)} samples), "
                    f"{len(noise_gaps)} noise gap(s)"
                )
                if trim_silence:
                    merge_samples = int(DENOISING_TRIM_MERGE_THRESHOLD * sample_rate)
                    audio_1d = _trim_to_longest_sfx_region(
                        audio_1d, noise_gaps, merge_samples
                    )
                    print(f"Kept longest SFX region ({len(audio_1d)} samples)")
                denoised_audio = nr.reduce_noise(
                    y=audio_1d,
                    sr=sample_rate,
                    y_noise=noise_profile,
                    prop_decrease=DENOISING_REDUCTION_STRENGTH,
                )
            else:
                print("No noise profile found, returning original audio")
                denoised_audio = audio_1d

            if was_multidim:
                denoised_audio = denoised_audio[np.newaxis, ...]

        denoised_tensor = torch.from_numpy(denoised_audio).to(
            dtype=original_dtype, device=original_device
        )
        print("Denoising completed successfully")
        return denoised_tensor

    except Exception as e:
        print(f"Error during denoising: {e}")
        print(f"Returning original audio without denoising")
        import traceback
        traceback.print_exc()
        return audio_tensor
