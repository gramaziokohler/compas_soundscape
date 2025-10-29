"""
Generate Sample Test Audio File

Creates a simple test audio file (1 second sine wave at 440Hz) for testing purposes.
This is useful if you don't have a test audio file available.

Usage:
    python generate_test_audio.py [output_filename.wav]

Requirements:
    pip install numpy scipy
"""

import numpy as np
from scipy.io import wavfile
import sys
from pathlib import Path

# Configuration
SAMPLE_RATE = 44100  # Hz
DURATION = 1.0  # seconds
FREQUENCY = 440.0  # Hz (A4 note)
AMPLITUDE = 0.3  # Volume (0.0 to 1.0)
DEFAULT_OUTPUT = "test_audio.wav"


def generate_sine_wave(frequency: float, duration: float, sample_rate: int, amplitude: float = 0.3) -> np.ndarray:
    """Generate a sine wave"""
    num_samples = int(sample_rate * duration)
    t = np.linspace(0, duration, num_samples, endpoint=False)
    wave = amplitude * np.sin(2 * np.pi * frequency * t)
    
    # Convert to 16-bit PCM
    wave_int16 = np.int16(wave * 32767)
    
    return wave_int16


def main():
    """Generate test audio file"""
    # Get output filename from command line or use default
    output_file = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    output_path = Path(output_file)
    
    print(f"Generating test audio file...")
    print(f"  Sample Rate: {SAMPLE_RATE} Hz")
    print(f"  Duration: {DURATION} seconds")
    print(f"  Frequency: {FREQUENCY} Hz (A4 note)")
    print(f"  Amplitude: {AMPLITUDE}")
    print(f"  Output: {output_path}")
    
    # Generate sine wave
    audio_data = generate_sine_wave(FREQUENCY, DURATION, SAMPLE_RATE, AMPLITUDE)
    
    # Save to file
    wavfile.write(str(output_path), SAMPLE_RATE, audio_data)
    
    # Verify file was created
    if output_path.exists():
        file_size = output_path.stat().st_size
        print(f"\n✅ Test audio file created successfully!")
        print(f"   Size: {file_size:,} bytes")
        print(f"   Path: {output_path.absolute()}")
        print(f"\nYou can now use this file with test_full_workflow.py")
    else:
        print(f"\n❌ Failed to create audio file")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except ImportError as e:
        print(f"\n❌ Missing required package: {e}")
        print("Install required packages with:")
        print("  pip install numpy scipy")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
