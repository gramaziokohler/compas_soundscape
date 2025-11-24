/**
 * Audio File Decoder Utilities
 *
 * Provides robust WAV file decoding with fallback strategies.
 * Uses wav-decoder library for formats that Web Audio API can't handle.
 */

import { decode as decodeWav } from 'wav-decoder';

/**
 * Audio file metadata extracted before decoding
 */
export interface AudioFileMetadata {
  fileName: string;
  fileSize: number;
  fileSizeMB: number;
  mimeType: string;
}

/**
 * Audio buffer info after decoding
 */
export interface AudioBufferInfo extends AudioFileMetadata {
  channels: number;
  sampleRate: number;
  duration: number;
  length: number;
}

/**
 * Extract metadata from audio file before decoding
 */
export function getAudioFileMetadata(file: File): AudioFileMetadata {
  return {
    fileName: file.name,
    fileSize: file.size,
    fileSizeMB: parseFloat((file.size / (1024 * 1024)).toFixed(2)),
    mimeType: file.type || 'unknown'
  };
}

/**
 * Get buffer info after decoding
 */
export function getAudioBufferInfo(buffer: AudioBuffer, metadata: AudioFileMetadata): AudioBufferInfo {
  return {
    ...metadata,
    channels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    duration: buffer.duration,
    length: buffer.length
  };
}

/**
 * Format buffer info for logging
 */
export function formatAudioBufferInfo(info: AudioBufferInfo): string {
  return [
    `File: ${info.fileName}`,
    `Size: ${info.fileSizeMB} MB`,
    `Channels: ${info.channels}`,
    `Sample Rate: ${info.sampleRate} Hz`,
    `Duration: ${info.duration.toFixed(2)}s`,
    `Length: ${info.length} samples`
  ].join(' | ');
}

/**
 * Decode audio file with fallback strategy
 *
 * Strategy:
 * 1. Try native Web Audio API decodeAudioData() (fastest, best compatibility)
 * 2. If that fails, try wav-decoder library (handles more WAV formats)
 * 3. If both fail, throw detailed error
 *
 * @param audioContext - Web Audio context
 * @param arrayBuffer - File data as ArrayBuffer
 * @param metadata - File metadata for error reporting
 * @returns Decoded AudioBuffer
 */
export async function decodeAudioFile(
  audioContext: AudioContext,
  arrayBuffer: ArrayBuffer,
  metadata: AudioFileMetadata
): Promise<AudioBuffer> {
  console.log('[AudioFileDecoder] Attempting to decode:', formatFileMetadata(metadata));

  // IMPORTANT: Clone the ArrayBuffer for native API attempt
  // The native decodeAudioData() detaches the buffer even on failure,
  // so we need a copy for the fallback decoder
  const arrayBufferCopy = arrayBuffer.slice(0);

  // STEP 1: Try native Web Audio API first (fastest)
  try {
    console.log('[AudioFileDecoder] Trying native decodeAudioData...');
    const audioBuffer = await audioContext.decodeAudioData(arrayBufferCopy);

    const info = getAudioBufferInfo(audioBuffer, metadata);
    console.log('[AudioFileDecoder] ✅ Native decoding successful:', formatAudioBufferInfo(info));

    return audioBuffer;
  } catch (nativeError) {
    console.warn('[AudioFileDecoder] ⚠️ Native decoding failed:', nativeError);
    console.log('[AudioFileDecoder] This often happens with:');
    console.log('  - 32-bit float WAV files');
    console.log('  - High channel count files (>8 channels)');
    console.log('  - Non-standard WAV encodings');
    console.log('[AudioFileDecoder] Attempting fallback with wav-decoder...');

    // STEP 2: Try wav-decoder library (handles more formats)
    // Use original arrayBuffer (not the detached copy)
    try {
      const audioData = await decodeWav(arrayBuffer);

      console.log('[AudioFileDecoder] wav-decoder results:', {
        sampleRate: audioData.sampleRate,
        channels: audioData.channelData.length,
        length: audioData.channelData[0]?.length || 0
      });

      // Convert wav-decoder output to Web Audio AudioBuffer
      const audioBuffer = audioContext.createBuffer(
        audioData.channelData.length,
        audioData.channelData[0].length,
        audioData.sampleRate
      );

      // Copy channel data
      for (let channel = 0; channel < audioData.channelData.length; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        channelData.set(audioData.channelData[channel]);
      }

      const info = getAudioBufferInfo(audioBuffer, metadata);
      console.log('[AudioFileDecoder] ✅ Fallback decoding successful:', formatAudioBufferInfo(info));

      return audioBuffer;
    } catch (fallbackError) {
      console.error('[AudioFileDecoder] ❌ Fallback decoding also failed:', fallbackError);

      // STEP 3: Both methods failed - throw detailed error
      throw new Error(
        `Failed to decode audio file: ${metadata.fileName}\n\n` +
        `File details:\n` +
        `  - Size: ${metadata.fileSizeMB} MB\n` +
        `  - Type: ${metadata.mimeType}\n\n` +
        `Native API error: ${nativeError instanceof Error ? nativeError.message : String(nativeError)}\n` +
        `Fallback error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}\n\n` +
        `Possible solutions:\n` +
        `  1. Convert to 16-bit PCM WAV format\n` +
        `  2. Try reducing channel count if >16 channels\n` +
        `  3. Check if file is corrupted\n` +
        `  4. Try a different audio editing tool for conversion`
      );
    }
  }
}

/**
 * Format file metadata for logging
 */
function formatFileMetadata(metadata: AudioFileMetadata): string {
  return [
    `${metadata.fileName}`,
    `(${metadata.fileSizeMB} MB,`,
    `${metadata.mimeType})`
  ].join(' ');
}

/**
 * Validate that channel count is supported
 */
export function validateChannelCount(channels: number): {
  valid: boolean;
  error?: string;
  suggestion?: string
} {
  const supportedCounts = [1, 2, 4, 9, 16];

  if (supportedCounts.includes(channels)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Unsupported channel count: ${channels}`,
    suggestion: `Supported counts are: ${supportedCounts.join(', ')} (mono, stereo, FOA, SOA, TOA)`
  };
}
