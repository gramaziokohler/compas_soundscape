/**
 * Audio File Upload Utilities
 *
 * Common utilities for uploading and processing audio files.
 * Used by impulse response, sound generation, and other audio features.
 */

import type { SEDAudioInfo } from "@/types";
import { AUDIO_FILE_EXTENSIONS } from '@/utils/constants';

/**
 * Result from audio file upload
 */
export interface AudioUploadResult {
  audioBuffer: AudioBuffer;
  audioInfo: SEDAudioInfo;
  audioUrl: string;
}

/**
 * Load audio file and create AudioBuffer + metadata
 *
 * This function:
 * 1. Reads the file as ArrayBuffer using FileReader
 * 2. Decodes audio to get AudioBuffer (for playback)
 * 3. Creates object URL for the file (for audio element src)
 * 4. Extracts metadata (duration, sample rate, channels)
 *
 * @param file - Audio file to upload
 * @param audioContext - Optional AudioContext to use for decoding (creates temp if not provided)
 * @returns Promise resolving to upload result
 *
 * Technical details:
 * - FileReader.readAsArrayBuffer() reads file as raw binary data
 * - AudioContext.decodeAudioData() converts compressed audio to PCM samples
 * - URL.createObjectURL() creates a temporary URL for the file (must be revoked later)
 * - Browser automatically handles format support (wav, mp3, flac, ogg, etc.)
 */
export async function loadAudioFile(
  file: File,
  audioContext?: AudioContext
): Promise<AudioUploadResult> {
  try {
    // Use provided context or create temporary one
    const context = audioContext || new AudioContext();

    // Read file as ArrayBuffer (raw binary data)
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

    // Decode audio data to AudioBuffer
    // This gives us the raw PCM samples for Web Audio API
    const audioBuffer = await context.decodeAudioData(arrayBuffer);

    // Create object URL for the file
    // This allows us to use it as src for <audio> elements or fetch it later
    const audioUrl = URL.createObjectURL(file);

    // Extract metadata
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

    console.log(`[Audio Upload] Loaded: ${file.name}`);
    console.log(`  Duration: ${audioInfo.duration.toFixed(2)}s`);
    console.log(`  Sample Rate: ${audioInfo.sample_rate} Hz`);
    console.log(`  Channels: ${audioInfo.channels}`);

    return {
      audioBuffer,
      audioInfo,
      audioUrl
    };

  } catch (error) {
    console.error('[Audio Upload] Failed to load audio file:', error);
    throw new Error(`Failed to load audio file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Revoke audio URL to free memory
 *
 * Call this when the audio is no longer needed to prevent memory leaks.
 * Object URLs remain in memory until the page is closed or explicitly revoked.
 *
 * @param audioUrl - URL created by URL.createObjectURL()
 */
export function revokeAudioUrl(audioUrl: string): void {
  try {
    URL.revokeObjectURL(audioUrl);
    console.log('[Audio Upload] Revoked audio URL');
  } catch (error) {
    console.warn('[Audio Upload] Failed to revoke URL:', error);
  }
}

/**
 * Validate if file is a supported audio format
 *
 * @param file - File to validate
 * @returns true if file appears to be audio
 */
export function isValidAudioFile(file: File): boolean {
  // Check MIME type first
  if (file.type.startsWith('audio/')) {
    return true;
  }

  // Fallback to extension check
  const fileName = file.name.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some(ext => fileName.endsWith(ext));
}

/**
 * Format file size for display
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "2.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
