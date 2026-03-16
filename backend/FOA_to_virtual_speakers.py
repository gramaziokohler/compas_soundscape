import numpy as np
import soundfile as sf
import os
import io
from pydub import AudioSegment

def decode_ambisonic_to_cube(input_filepath, output_directory=".", export_format="wav", mp3_bitrate="192k"):
    print(f"Loading '{input_filepath}'...")
    
    # Read the multi-channel wav file
    data, samplerate = sf.read(input_filepath)
    
    # Verify the file has exactly 4 channels
    if data.ndim == 1 or data.shape[1] != 4:
        raise ValueError("Error: The input file must have exactly 4 channels.")

    print(f"Sample rate: {samplerate} Hz. Processing {len(data)} samples.")

    # Extract the channels (Assuming W, X, Y, Z order)
    W = data[:, 0]
    X = data[:, 1]
    Y = data[:, 2]
    Z = data[:, 3]

    # The 1/8th multiplier to prevent volume clipping
    g = 0.125

    # Apply the decoding matrix
    print(f"Decoding to 8 virtual speakers (Format: {export_format.upper()})...")
    speakers = {
        "Front_Left_Up":    g * (W + X + Y + Z),
        "Front_Right_Up":   g * (W + X - Y + Z),
        "Back_Left_Up":     g * (W - X + Y + Z),
        "Back_Right_Up":    g * (W - X - Y + Z),
        "Front_Left_Down":  g * (W + X + Y - Z),
        "Front_Right_Down": g * (W + X - Y - Z),
        "Back_Left_Down":   g * (W - X + Y - Z),
        "Back_Right_Down":  g * (W - X - Y - Z)
    }

    # Create the output directory if it doesn't exist
    if not os.path.exists(output_directory):
        os.makedirs(output_directory)

    export_format = export_format.lower()

    # Export the 8 individual mono files
    for name, audio_data in speakers.items():
        output_filename = os.path.join(output_directory, f"{name}.{export_format}")
        
        if export_format == "mp3":
            # MP3 Export: Write to a temporary memory buffer as a 16-bit WAV first
            wav_io = io.BytesIO()
            sf.write(wav_io, audio_data, samplerate, format='wav', subtype='PCM_16')
            wav_io.seek(0)
            
            # Use pydub to read the buffer and export as MP3
            audio_segment = AudioSegment.from_wav(wav_io)
            audio_segment.export(output_filename, format="mp3", bitrate=mp3_bitrate)
            
        elif export_format == "wav":
            # WAV Export: Save directly as 24-bit PCM WAV
            sf.write(output_filename, audio_data, samplerate, subtype='PCM_24')
            
        else:
            raise ValueError(f"Unsupported export format: {export_format}")

        print(f"Saved: {output_filename}")

    print("Decoding complete!")

# --- Execute the script ---
if __name__ == "__main__":
    
    input_file = "G:\\My Drive\\03_ETH Acoustic\\02_Work\\00_Case studies\\HIL Extension - MAS\\soundscape_Reciprocal_lecture_4ch_296s.wav" 
    output_folder = "G:\\My Drive\\03_ETH Acoustic\\02_Work\\00_Case studies\\HIL Extension - MAS\\Funicular_2_inside_robots_FOA"
    
    # You can now change "wav" to "mp3" here
    chosen_format = "mp3" 
    
    try:
        decode_ambisonic_to_cube(
            input_filepath=input_file, 
            output_directory=output_folder, 
            export_format=chosen_format,
            mp3_bitrate="192k" # Feel free to change to "320k" for higher quality
        )
    except Exception as e:
        print(f"Failed to process: {e}")