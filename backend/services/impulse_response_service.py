"""Service for handling impulse response files"""

import os
import hashlib
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
        name: str
    ) -> Tuple[ImpulseResponseMetadata, str]:
        """
        Process uploaded IR file and save in appropriate format
        
        Args:
            file_path: Path to uploaded temporary file
            name: User-provided name for the IR
            
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
        
        # Generate unique filename
        file_hash = hashlib.md5(audio_data.tobytes()).hexdigest()[:8]
        safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_name = safe_name.replace(' ', '_')
        filename = f"{safe_name}_{ir_format}_{file_hash}.wav"
        output_path = os.path.join(IMPULSE_RESPONSE_DIR, filename)
        
        # Save processed IR
        # Transpose back to (samples, channels) for soundfile
        sf.write(output_path, audio_data.T, sample_rate, subtype='PCM_16')
        
        # Get file size
        file_size = os.path.getsize(output_path)
        
        # Calculate duration
        duration = audio_data.shape[1] / sample_rate
        
        # Create metadata
        metadata = ImpulseResponseMetadata(
            id=file_hash,
            url=f"{IMPULSE_RESPONSE_URL_PREFIX}/{filename}",
            name=name,
            format=IRFormat(ir_format),
            channels=target_channels,
            original_channels=original_channels,
            sample_rate=sample_rate,
            duration=duration,
            file_size=file_size
        )
        
        return metadata, output_path
    
    def list_impulse_responses(self) -> list[ImpulseResponseMetadata]:
        """
        List all available impulse responses
        
        Returns:
            List of IR metadata objects
        """
        # TODO: Implement persistent storage (database or JSON file)
        # For now, scan directory
        irs = []
        
        if not os.path.exists(IMPULSE_RESPONSE_DIR):
            return irs
        
        for filename in os.listdir(IMPULSE_RESPONSE_DIR):
            if not filename.endswith('.wav'):
                continue
            
            filepath = os.path.join(IMPULSE_RESPONSE_DIR, filename)
            
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
                
                metadata = ImpulseResponseMetadata(
                    id=file_hash,
                    url=f"{IMPULSE_RESPONSE_URL_PREFIX}/{filename}",
                    name=name,
                    format=IRFormat(ir_format),
                    channels=channels,
                    original_channels=channels,
                    sample_rate=sample_rate,
                    duration=duration,
                    file_size=file_size
                )
                
                irs.append(metadata)
                
            except Exception as e:
                print(f"Error reading IR file {filename}: {e}")
                continue
        
        return irs
    
    def delete_impulse_response(self, ir_id: str) -> bool:
        """
        Delete an impulse response by ID
        
        Args:
            ir_id: Hash ID of the IR to delete
            
        Returns:
            True if deleted, False if not found
            
        Raises:
            ValueError: If deletion fails
        """
        if not os.path.exists(IMPULSE_RESPONSE_DIR):
            return False
        
        # Find file with matching hash ID
        for filename in os.listdir(IMPULSE_RESPONSE_DIR):
            if not filename.endswith('.wav'):
                continue
            
            # Extract hash from filename: {name}_{format}_{hash}.wav
            parts = filename[:-4].split('_')
            if len(parts) >= 3:
                file_hash = parts[-1]
            else:
                file_hash = filename[:8]
            
            if file_hash == ir_id:
                filepath = os.path.join(IMPULSE_RESPONSE_DIR, filename)
                try:
                    os.unlink(filepath)
                    print(f"Deleted IR: {filename}")
                    return True
                except Exception as e:
                    raise ValueError(f"Failed to delete IR file: {str(e)}")
        
        return False
