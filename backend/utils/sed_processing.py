"""
Sound Event Detection (SED) Processing Utilities

This module provides reusable functions for audio analysis including:
- Audio loading and preprocessing
- Amplitude calculations (RMS, dB conversion)
- Segment analysis for detected sound classes
"""

import numpy as np
import librosa
import warnings
from typing import Tuple, Optional
from config.constants import (
    TARGET_SAMPLE_RATE,
    DETECTION_THRESHOLD,
    FRAME_HOP_SECONDS,
    FRAME_WINDOW_SECONDS,
)


def load_audio(file_path: str, target_sr: int = TARGET_SAMPLE_RATE) -> Tuple[Optional[np.ndarray], Optional[int]]:
    """
    Loads, converts to mono, and resamples audio file.

    Args:
        file_path: Path to audio file
        target_sr: Target sample rate (default: 16000 Hz)

    Returns:
        tuple: (waveform as numpy array, sample rate) or (None, None) on error

    Technical details:
        - Uses librosa.load() which automatically converts to mono and resamples
        - Returns normalized float32 array with values in [-1.0, 1.0]
        - Handles various formats: wav, mp3, flac, ogg, m4a

    Raises:
        Exception: If audio file is corrupted, has invalid format, or cannot be loaded
    """
    try:
        # Load audio with librosa
        # - sr=None: Keep original sample rate
        # - mono=True: Convert stereo to mono by averaging channels
        waveform, sr_orig = librosa.load(file_path, sr=None, mono=True)

        # Validate loaded audio
        if waveform is None or len(waveform) == 0:
            raise ValueError(f"Audio file loaded with 0 samples. File may be corrupted or have invalid format.")

        print(f"Audio loaded: {len(waveform)} samples at {sr_orig} Hz")

        # Resample if needed
        if sr_orig != target_sr:
            print(f"Resampling from {sr_orig} Hz to {target_sr} Hz...")
            # librosa.resample() in v0.11.0+ requires explicit y= parameter
            waveform = librosa.resample(y=waveform, orig_sr=sr_orig, target_sr=target_sr)

            if waveform is None or len(waveform) == 0:
                raise ValueError(f"Resampling failed - output is empty")

            print(f"Resampled to: {len(waveform)} samples at {target_sr} Hz")

        return waveform, target_sr

    except FileNotFoundError:
        print(f"ERROR: Audio file not found: {file_path}")
        return None, None
    except Exception as e:
        print(f"ERROR: Failed to load audio file: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return None, None


def calculate_rms_amplitude(waveform_segment: np.ndarray) -> float:
    """
    Calculates the Root Mean Square (RMS) amplitude of a waveform segment.

    RMS amplitude represents the "average" signal level and is calculated as:
    RMS = sqrt(mean(x^2))

    Args:
        waveform_segment: Audio samples as numpy array

    Returns:
        float: RMS amplitude value (0.0 if segment is empty)

    Technical details:
        - Uses float64 for intermediate calculations to avoid overflow
        - Suppresses RuntimeWarning for empty slices
        - Returns 0.0 for negative values (shouldn't happen but safety check)
    """
    if waveform_segment.size == 0:
        return 0.0

    # Suppress RuntimeWarning: Mean of empty slice
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        # Convert to float64 to avoid potential overflow with float32
        squared_waveform = np.power(waveform_segment.astype(np.float64), 2)
        mean_squared = np.mean(squared_waveform)

    # Safety check for negative values (shouldn't occur)
    if mean_squared < 0:
        return 0.0

    rms_amplitude = np.sqrt(mean_squared)
    return rms_amplitude


def amplitude_to_db(amplitude: float) -> float:
    """
    Converts linear amplitude value to decibels (dBFS).

    dBFS (decibels relative to Full Scale) formula:
    dB = 20 * log10(amplitude / reference)

    Where reference = 1.0 (max amplitude for normalized float audio)

    Args:
        amplitude: Linear amplitude value (0.0 to 1.0 for normalized audio)

    Returns:
        float: Amplitude in dBFS (-inf for zero amplitude)

    Technical details:
        - Uses epsilon (1e-10) to avoid log(0) which would be undefined
        - Returns -inf for very small values (below threshold)
        - Reference level is 1.0 (maximum for normalized float audio)
    """
    if amplitude <= 1e-10:  # Use epsilon to avoid log(0)
        return -np.inf

    # Ensure amplitude is positive before log10
    amplitude = max(amplitude, 1e-10)
    # dB = 20 * log10(amplitude / reference), where reference = 1.0
    db = 20 * np.log10(amplitude / 1.0)
    return db


def format_duration_range(durations_sec: list) -> str:
    """
    Formats a list of durations into a readable "min - max" string.

    Args:
        durations_sec: List of duration values in seconds

    Returns:
        str: Formatted duration range (e.g., "1.50s - 3.20s" or "2.00s" if all equal)
    """
    if not durations_sec:
        return "N/A"

    min_dur = min(durations_sec)
    max_dur = max(durations_sec)

    # If all durations are approximately equal, show single value
    if np.isclose(min_dur, max_dur):
        return f"{min_dur:.2f}s"
    else:
        return f"{min_dur:.2f}s - {max_dur:.2f}s"


def analyze_class_segments(
    class_scores: np.ndarray,
    frame_hop_sec: float,
    threshold: float
) -> Tuple[list, list]:
    """
    Analyzes segments where a sound class is detected or silent based on threshold.

    Detection algorithm:
        1. Create boolean array: detected = (class_scores >= threshold)
        2. Pad array with False on both ends for edge detection
        3. Use np.diff() to find transitions: 1 = start, -1 = end
        4. Calculate duration of detected segments and silence gaps

    Args:
        class_scores: Confidence scores for a single class across frames
        frame_hop_sec: Time between consecutive frames in seconds
        threshold: Detection threshold (0.0 to 1.0)

    Returns:
        tuple: (detected_durations_sec, silent_durations_sec) as lists of floats (seconds)
    """
    if class_scores.size == 0:
        return [], []

    num_frames = len(class_scores)
    detected = class_scores >= threshold

    # Pad with False on both ends to detect edges properly
    # Example: [True, False, True] -> [False, True, False, True, False]
    padded_detected = np.concatenate(([False], detected, [False]))

    # np.diff() computes differences between consecutive elements
    # When converted to int: False=0, True=1
    # Difference of +1 means transition False->True (detection start)
    # Difference of -1 means transition True->False (detection end)
    diff = np.diff(padded_detected.astype(int))

    start_indices = np.where(diff == 1)[0]  # Start of detection segments
    end_indices = np.where(diff == -1)[0] - 1  # End indices (inclusive)

    # Calculate detected segment durations
    detected_durations_sec = []
    if len(start_indices) > 0:
        detected_durations_frames = end_indices - start_indices + 1
        detected_durations_sec = (detected_durations_frames * frame_hop_sec).tolist()

    # Calculate silence durations (gaps between detections)
    silent_durations_sec = []

    if len(start_indices) == 0:
        # Never detected - entire audio is "silent" for this class
        if num_frames > 0:
            silent_durations_sec.append(num_frames * frame_hop_sec)
    else:
        # Silence before first detection
        if start_indices[0] > 0:
            silent_durations_sec.append(start_indices[0] * frame_hop_sec)

        # Silence between detections
        for i in range(len(start_indices) - 1):
            gap_frames = start_indices[i+1] - end_indices[i] - 1
            if gap_frames > 0:
                silent_durations_sec.append(gap_frames * frame_hop_sec)

        # Silence after last detection
        if end_indices[-1] < num_frames - 1:
            gap_frames = num_frames - 1 - end_indices[-1]
            silent_durations_sec.append(gap_frames * frame_hop_sec)
    
    return detected_durations_sec, silent_durations_sec
    # return format_duration_range(detected_durations_sec), format_duration_range(silent_durations_sec)


def calculate_amplitude_stats_for_class(
    waveform: np.ndarray,
    sample_rate: int,
    class_scores: np.ndarray,
    frame_hop_sec: float,
    frame_window_sec: float,
    threshold: float
) -> Tuple[float, float, float, float]:
    """
    Calculates amplitude statistics (Max and RMS) during times when a class is detected.

    Algorithm:
        1. Find all frames where class_scores >= threshold
        2. Map frame indices to sample indices using frame timing
        3. Extract waveform samples for detected regions
        4. Calculate max absolute amplitude and RMS amplitude

    Args:
        waveform: Audio samples array
        sample_rate: Sample rate in Hz
        class_scores: Confidence scores for a single class
        frame_hop_sec: Time between frames
        frame_window_sec: Duration of each frame window
        threshold: Detection threshold

    Returns:
        tuple: (max_amp_0_1, max_amp_db, avg_amp_0_1, avg_amp_db)
            - max_amp_0_1: Max amplitude in [0,1] range
            - max_amp_db: Max amplitude in dBFS
            - avg_amp_0_1: RMS amplitude in [0,1] range
            - avg_amp_db: RMS amplitude in dBFS
    """
    # Default values if no detection
    default_return = (0.0, -np.inf, 0.0, -np.inf)

    if waveform.size == 0 or class_scores.size == 0:
        return default_return

    # Find frames where class is detected
    detected_frame_indices = np.where(class_scores >= threshold)[0]

    if detected_frame_indices.size == 0:
        return default_return

    # Map frame indices to sample indices
    # Each frame starts at (frame_idx * frame_hop_sec) and lasts frame_window_sec
    relevant_sample_indices = set()
    num_samples = waveform.size

    for frame_idx in detected_frame_indices:
        start_time = frame_idx * frame_hop_sec
        end_time = start_time + frame_window_sec

        # Convert time to sample indices
        # floor() for start ensures we don't miss the beginning
        # ceil() for end ensures we capture the full window
        start_sample = int(np.floor(start_time * sample_rate))
        end_sample = int(np.ceil(end_time * sample_rate))

        # Clamp to waveform length
        end_sample = min(num_samples, end_sample)
        start_sample = max(0, start_sample)

        if start_sample < end_sample:
            relevant_sample_indices.update(range(start_sample, end_sample))

    if not relevant_sample_indices:
        return default_return

    # Extract detected waveform segment
    indices_array = np.array(sorted(list(relevant_sample_indices)))
    valid_indices = indices_array[indices_array < num_samples]

    if valid_indices.size == 0:
        return default_return

    detected_waveform_segment = waveform[valid_indices]

    # Calculate MAX absolute amplitude
    # np.max(np.abs()) finds the peak amplitude (positive or negative)
    max_amp_0_1 = np.max(np.abs(detected_waveform_segment))
    max_amp_db = amplitude_to_db(max_amp_0_1)

    # Calculate Average (RMS) amplitude
    avg_amp_0_1 = calculate_rms_amplitude(detected_waveform_segment)
    avg_amp_db = amplitude_to_db(avg_amp_0_1)

    return max_amp_0_1, max_amp_db, avg_amp_0_1, avg_amp_db
