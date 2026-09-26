"""Service for handling impulse response files"""

import os
import uuid
import soundfile as sf
import numpy as np
from typing import Tuple, Optional
from pathlib import Path

from config.constants import (
    IMPULSE_RESPONSE_DIR,
    IMPULSE_RESPONSE_URL_PREFIX,
    SUPPORTED_IR_CHANNELS,
    MAX_IR_CHANNELS,
    IR_FORMAT_MONO,
    IR_FORMAT_BINAURAL,
    IR_FORMAT_FOA,
    IR_FORMAT_TOA,
    AUDIO_SAMPLE_RATE
)
from models.schemas import ImpulseResponseMetadata, IRFormat


class ImpulseResponseService:
    """Service for processing and managing impulse response files"""
    
    def __init__(self):
        """Initialize IR service and ensure directories exist"""
        os.makedirs(IMPULSE_RESPONSE_DIR, exist_ok=True)
        # path -> (mtime, peak) cache so list_impulse_responses does not re-read
        # every file's samples on each call.
        self._peak_cache: dict[str, tuple[float, float]] = {}

    @staticmethod
    def _library_dir(workspace_id: Optional[str]) -> Path:
        """Workspace-scoped IR library directory.

        With a workspace id the IRs live under ``impulse_responses/<workspace_id>/``
        (served at ``/static/impulse_responses/<workspace_id>/<file>``); without
        one they fall back to the shared root (legacy / no-session calls).
        """
        root = Path(IMPULSE_RESPONSE_DIR)
        return root / workspace_id if workspace_id else root

    @staticmethod
    def _library_url(workspace_id: Optional[str], filename: str) -> str:
        if workspace_id:
            return f"{IMPULSE_RESPONSE_URL_PREFIX}/{workspace_id}/{filename}"
        return f"{IMPULSE_RESPONSE_URL_PREFIX}/{filename}"

    @staticmethod
    def _compute_peak(audio_data: np.ndarray) -> float:
        """Peak absolute sample (max across channels) in the float [-1, 1] domain."""
        if audio_data.size == 0:
            return 0.0
        return float(np.max(np.abs(audio_data)))
    
    def detect_ir_format(self, channels: int) -> str:
        """
        Detect IR format based on channel count
        
        Args:
            channels: Number of audio channels
            
        Returns:
            IR format string ("mono", "binaural", "foa", or "toa")
        """
        if channels == 1:
            return IR_FORMAT_MONO
        elif channels == 2:
            return IR_FORMAT_BINAURAL
        elif channels == 4:
            return IR_FORMAT_FOA
        elif channels == 16:
            return IR_FORMAT_TOA
        else:
            raise ValueError(
                f"Unsupported channel count: {channels}. "
                f"Supported: {SUPPORTED_IR_CHANNELS}"
            )
    
    def extract_channels(
        self, 
        audio_data: np.ndarray, 
        target_channels: int
    ) -> np.ndarray:
        """
        Extract first N channels from audio data
        
        Handles files from simulation software (e.g., Odeon) that may have
        extra channels beyond what we need.
        
        Args:
            audio_data: Audio data array (channels, samples) or (samples,) for mono
            target_channels: Number of channels to extract (1, 2, 4, or 16)
            
        Returns:
            Audio data with extracted channels
        """
        # Handle mono input
        if audio_data.ndim == 1:
            if target_channels == 1:
                return audio_data
            else:
                raise ValueError(
                    f"Cannot extract {target_channels} channels from mono audio"
                )
        
        # Multi-channel input
        current_channels = audio_data.shape[0] if audio_data.ndim == 2 else 1
        
        if current_channels < target_channels:
            raise ValueError(
                f"Audio has {current_channels} channels, "
                f"cannot extract {target_channels}"
            )
        
        if current_channels == target_channels:
            return audio_data
        
        # Extract first N channels
        print(f"Extracting first {target_channels} channels from {current_channels}-channel audio")
        return audio_data[:target_channels, :]
    
    def process_ir_file(
        self, 
        file_path: str, 
        name: str,
        workspace_id: Optional[str] = None,
    ) -> Tuple[ImpulseResponseMetadata, str]:
        """
        Process uploaded IR file and save in appropriate format

        Args:
            file_path: Path to uploaded temporary file
            name: User-provided name for the IR
            workspace_id: Owning workspace — the IR is stored under
                ``impulse_responses/<workspace_id>/`` so one workspace never
                sees or shares another's uploaded IRs.

        Returns:
            Tuple of (metadata, output_file_path)
        """
        # Read audio file
        audio_data, sample_rate = sf.read(file_path, always_2d=True)
        original_channels = audio_data.shape[1]
        
        # Transpose to (channels, samples) format
        audio_data = audio_data.T
        
        print(f"Loaded IR: {original_channels} channels, {sample_rate} Hz, "
              f"{audio_data.shape[1]} samples")
        
        # Determine target channel count
        if original_channels <= 2:
            target_channels = original_channels
        elif original_channels >= 16:
            target_channels = 16  # Extract TOA (first 16 channels)
        elif original_channels >= 4:
            target_channels = 4   # Extract FOA (first 4 channels)
        else:
            raise ValueError(
                f"Unexpected channel count: {original_channels}. "
                f"Expected 1, 2, 4-16, or 16+"
            )
        
        # Extract channels if needed
        if original_channels != target_channels:
            audio_data = self.extract_channels(audio_data, target_channels)
        
        # Detect format
        ir_format = self.detect_ir_format(target_channels)
        
        # Resample if needed
        if sample_rate != AUDIO_SAMPLE_RATE:
            print(f"Resampling IR from {sample_rate} Hz to {AUDIO_SAMPLE_RATE} Hz")
            import scipy.signal
            audio_data = scipy.signal.resample_poly(
                audio_data, 
                AUDIO_SAMPLE_RATE, 
                sample_rate,
                axis=1
            )
            sample_rate = AUDIO_SAMPLE_RATE
        
        # Generate unique filename using UUID so every upload has a unique ID
        # regardless of audio content (content hashes caused duplicate IDs when
        # two source-receiver pairs produced identical or near-identical IRs).
        unique_id = uuid.uuid4().hex[:16]
        safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_name = safe_name.replace(' ', '_')
        filename = f"{safe_name}_{ir_format}_{unique_id}.wav"
        dest_dir = self._library_dir(workspace_id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        output_path = os.path.join(str(dest_dir), filename)
        
        # Save processed IR
        # Transpose back to (samples, channels) for soundfile
        sf.write(output_path, audio_data.T, sample_rate, subtype='PCM_16')
        
        # Get file size
        file_size = os.path.getsize(output_path)
        
        # Calculate duration
        duration = audio_data.shape[1] / sample_rate
        
        # Peak absolute amplitude (max across channels) in float domain
        peak_amplitude = self._compute_peak(audio_data)

        # Acoustic metrics — same computation the pyroomacoustics worker runs after
        # compute_rir(). Use the first channel, matching its FOA convention
        # (W = channel 0). Failure must not break the upload.
        acoustic_parameters = None
        try:
            # Lazy import: utils.acoustic_measurement pulls in pyroomacoustics, only
            # needed when an IR is actually uploaded (matches choras_service).
            from utils.acoustic_measurement import AcousticMeasurement
            acoustic_parameters = AcousticMeasurement.calculate_acoustic_parameters_from_rir(
                audio_data[0], sample_rate
            )
        except Exception as ap_err:
            print(f"Warning: acoustic parameters failed for IR '{name}': {ap_err}")

        # Create metadata
        metadata = ImpulseResponseMetadata(
            id=unique_id,
            url=self._library_url(workspace_id, filename),
            name=name,
            format=IRFormat(ir_format),
            channels=target_channels,
            original_channels=original_channels,
            sample_rate=sample_rate,
            duration=duration,
            file_size=file_size,
            peak_amplitude=peak_amplitude,
            acoustic_parameters=acoustic_parameters
        )
        
        return metadata, output_path
    
    def list_impulse_responses(self, workspace_id: Optional[str] = None) -> list[ImpulseResponseMetadata]:
        """
        List impulse responses available to a workspace.

        Scoped to ``impulse_responses/<workspace_id>/`` so a user only ever sees
        the IRs their own workspace uploaded. Without a workspace id, falls back
        to the shared root (legacy / no-session calls).

        Returns:
            List of IR metadata objects
        """
        irs = []
        library_dir = self._library_dir(workspace_id)

        if not library_dir.exists():
            return irs

        for filename in os.listdir(str(library_dir)):
            if not filename.endswith('.wav'):
                continue

            filepath = os.path.join(str(library_dir), filename)
            
            try:
                # Read file metadata
                info = sf.info(filepath)
                channels = info.channels
                sample_rate = info.samplerate
                duration = info.duration
                file_size = os.path.getsize(filepath)
                
                # Extract info from filename
                # Format: {name}_{format}_{hash}.wav
                parts = filename[:-4].split('_')
                if len(parts) >= 3:
                    ir_format = parts[-2]
                    file_hash = parts[-1]
                    name = '_'.join(parts[:-2])
                else:
                    name = filename[:-4]
                    ir_format = self.detect_ir_format(channels)
                    file_hash = filename[:8]
                
                # Peak amplitude (cached by path+mtime so repeat listings stay cheap)
                mtime = os.path.getmtime(filepath)
                cached = self._peak_cache.get(filepath)
                if cached is not None and cached[0] == mtime:
                    peak_amplitude = cached[1]
                else:
                    ir_samples, _ = sf.read(filepath, always_2d=True)
                    peak_amplitude = self._compute_peak(ir_samples)
                    self._peak_cache[filepath] = (mtime, peak_amplitude)
                
                metadata = ImpulseResponseMetadata(
                    id=file_hash,
                    url=self._library_url(workspace_id, filename),
                    name=name,
                    format=IRFormat(ir_format),
                    channels=channels,
                    original_channels=channels,
                    sample_rate=sample_rate,
                    duration=duration,
                    file_size=file_size,
                    peak_amplitude=peak_amplitude
                )
                
                irs.append(metadata)
                
            except Exception as e:
                print(f"Error reading IR file {filename}: {e}")
                continue
        
        return irs
    
    def delete_impulse_response(self, ir_id: str, workspace_id: Optional[str] = None) -> bool:
        """
        Delete an impulse response by ID within a workspace.

        Args:
            ir_id: Hash ID of the IR to delete
            workspace_id: Owning workspace (scopes the search)

        Returns:
            True if deleted, False if not found

        Raises:
            ValueError: If deletion fails
        """
        library_dir = self._library_dir(workspace_id)
        if not library_dir.exists():
            return False

        # Find file with matching hash ID
        for filename in os.listdir(str(library_dir)):
            if not filename.endswith('.wav'):
                continue

            # Extract hash from filename: {name}_{format}_{hash}.wav
            parts = filename[:-4].split('_')
            if len(parts) >= 3:
                file_hash = parts[-1]
            else:
                file_hash = filename[:8]

            if file_hash == ir_id:
                filepath = os.path.join(str(library_dir), filename)
                try:
                    os.unlink(filepath)
                    print(f"Deleted IR: {filename}")
                    return True
                except Exception as e:
                    raise ValueError(f"Failed to delete IR file: {str(e)}")

        return False
