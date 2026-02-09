import { AUDIO_FILE_EXTENSIONS, MODEL_FILE_EXTENSIONS } from '@/utils/constants';

/**
 * Audio Information Utilities
 *
 * Reusable functions for extracting and formatting audio metadata.
 * Used by both impulse response and SED features.
 */

import type { SEDAudioInfo } from "@/types";

/**
 * Audio info display format (generic)
 */
export interface AudioInfoDisplay {
  duration: string;
  sampleRate: string;
  channels: string;
  samples?: string;
  filename?: string;
}

/**
 * Get audio buffer info for display (from Web Audio API AudioBuffer)
 *
 * @param buffer - AudioBuffer from Web Audio API
 * @returns Formatted audio info or null if buffer is null
 *
 * Technical details:
 * - AudioBuffer properties: duration (seconds), sampleRate (Hz), numberOfChannels
 * - Channel names: 1="Mono", 2="Stereo", N="{N} ch"
 */
export function getAudioBufferInfo(buffer: AudioBuffer | null): AudioInfoDisplay | null {
  if (!buffer) return null;

  return {
    duration: `${buffer.duration.toFixed(3)}s`,
    sampleRate: `${buffer.sampleRate}Hz`,
    channels: buffer.numberOfChannels === 1
      ? "Mono"
      : buffer.numberOfChannels === 2
      ? "Stereo"
      : `${buffer.numberOfChannels} ch`,
    samples: `${buffer.length.toLocaleString()}`
  };
}

/**
 * Get audio info from SED analysis result
 *
 * @param audioInfo - Audio info from backend SED analysis
 * @returns Formatted audio info display
 */
export function getSEDAudioInfo(audioInfo: SEDAudioInfo): AudioInfoDisplay {
  return {
    duration: `${audioInfo.duration.toFixed(3)}s`,
    sampleRate: `${audioInfo.sample_rate}Hz`,
    channels: audioInfo.channels,
    samples: `${audioInfo.num_samples.toLocaleString()}`,
    filename: audioInfo.filename
  };
}

/**
 * Get audio file info from File object (estimates only, no decoding)
 *
 * @param file - File object from file input
 * @returns Basic file info
 *
 * Note: This only provides file metadata, not audio properties.
 * For actual audio properties, the file must be decoded.
 */
export function getAudioFileBasicInfo(file: File): { name: string; size: string; type: string } {
  return {
    name: file.name,
    // Convert bytes to KB/MB
    size: file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(1)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    type: file.type || getFileExtension(file.name)
  };
}

/**
 * Load audio file and extract metadata using Web Audio API
 *
 * This function decodes the audio file to get accurate information about
 * duration, sample rate, and channels. Uses the same approach as impulse
 * response loading but without the normalization/processing steps.
 *
 * @param file - Audio file to analyze
 * @returns Promise resolving to audio info or null on error
 *
 * Technical details:
 * - Creates temporary AudioContext for decoding
 * - FileReader.readAsArrayBuffer() reads file as raw binary data
 * - AudioContext.decodeAudioData() converts to AudioBuffer
 * - Browser automatically handles various audio formats (wav, mp3, flac, etc.)
 * - AudioContext is not closed to avoid state issues
 */
export async function loadAudioFileInfo(file: File): Promise<SEDAudioInfo | null> {
  try {
    // Create temporary AudioContext for decoding
    // AudioContext is needed to decode audio files to get their properties
    const audioContext = new AudioContext();

    // Read file as ArrayBuffer (raw binary data)
    // FileReader is an async API for reading file contents
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      // onload fires when reading completes successfully
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      // onerror fires if reading fails
      reader.onerror = () => reject(reader.error);
      // Start reading the file as binary data
      reader.readAsArrayBuffer(file);
    });

    // Decode audio data to AudioBuffer
    // decodeAudioData() converts compressed audio to raw PCM samples
    // Supports: wav, mp3, ogg, flac, m4a (browser-dependent)
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Extract metadata from decoded buffer
    const audioInfo: SEDAudioInfo = {
      duration: audioBuffer.duration,
      sample_rate: audioBuffer.sampleRate,
      num_samples: audioBuffer.length,
      channels: audioBuffer.numberOfChannels === 1
        ? "Mono"
        : audioBuffer.numberOfChannels === 2
        ? "Stereo"
        : `${audioBuffer.numberOfChannels} ch`,
      filename: file.name
    };

    console.log(`[Audio Info] Loaded: ${file.name}`);
    console.log(`  Duration: ${audioInfo.duration.toFixed(2)}s`);
    console.log(`  Sample Rate: ${audioInfo.sample_rate} Hz`);
    console.log(`  Channels: ${audioInfo.channels}`);

    return audioInfo;

  } catch (error) {
    console.error('[Audio Info] Failed to load audio file:', error);
    return null;
  }
}

/**
 * Load audio file and return both metadata and AudioBuffer for visualization
 *
 * This is similar to loadAudioFileInfo but returns the AudioBuffer as well
 * for waveform visualization purposes.
 *
 * @param file - Audio file to analyze
 * @returns Promise resolving to audio info and buffer, or null on error
 */
export async function loadAudioFileWithBuffer(
  file: File
): Promise<{ audioInfo: SEDAudioInfo; audioBuffer: AudioBuffer } | null> {
  try {
    // Create temporary AudioContext for decoding
    const audioContext = new AudioContext();

    // Read file as ArrayBuffer (raw binary data)
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

    // Decode audio data to AudioBuffer
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Extract metadata from decoded buffer
    const audioInfo: SEDAudioInfo = {
      duration: audioBuffer.duration,
      sample_rate: audioBuffer.sampleRate,
      num_samples: audioBuffer.length,
      channels: audioBuffer.numberOfChannels === 1
        ? "Mono"
        : audioBuffer.numberOfChannels === 2
        ? "Stereo"
        : `${audioBuffer.numberOfChannels} ch`,
      filename: file.name
    };

    console.log(`[Audio Info] Loaded with buffer: ${file.name}`);
    console.log(`  Duration: ${audioInfo.duration.toFixed(2)}s`);
    console.log(`  Sample Rate: ${audioInfo.sample_rate} Hz`);
    console.log(`  Channels: ${audioInfo.channels}`);

    return { audioInfo, audioBuffer };

  } catch (error) {
    console.error('[Audio Info] Failed to load audio file with buffer:', error);
    return null;
  }
}

/**
 * Extract file extension from filename
 */
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : 'unknown';
}

/**
 * Check if file is an audio file by extension
 *
 * @param filename - Filename to check
 * @returns true if file appears to be audio
 */
export function isAudioFile(filename: string): boolean {
  const ext = getFileExtension(filename).toLowerCase();
  return AUDIO_FILE_EXTENSIONS.includes(ext);
}

/**
 * Check if file is a 3D model by extension
 *
 * @param filename - Filename to check
 * @returns true if file appears to be a 3D model
 */
export function is3DModelFile(filename: string): boolean {
  const ext = getFileExtension(filename).toLowerCase();
  return MODEL_FILE_EXTENSIONS.includes(ext);
}

/**
 * Format confidence score as percentage
 *
 * @param confidence - Confidence value (0-1)
 * @returns Formatted percentage string
 */
export function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(1)}%`;
}

/**
 * Format amplitude in dB with appropriate precision
 *
 * @param db - Amplitude in dBFS
 * @returns Formatted dB string
 */
export function formatAmplitudeDB(db: number | null): string {
  if (db === null || !isFinite(db)) return 'N/A';
  return `${db.toFixed(1)} dB`;
}
