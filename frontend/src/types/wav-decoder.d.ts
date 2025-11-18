/**
 * Type definitions for wav-decoder
 * wav-decoder is a library for decoding WAV audio files
 */

declare module 'wav-decoder' {
  /**
   * Decoded audio data structure
   */
  export interface AudioData {
    /** Sample rate in Hz */
    sampleRate: number;
    /** Array of Float32Arrays, one per channel */
    channelData: Float32Array[];
  }

  /**
   * Decode a WAV file from an ArrayBuffer
   * @param arrayBuffer - The WAV file data as ArrayBuffer
   * @returns Promise resolving to decoded audio data
   */
  export function decode(arrayBuffer: ArrayBuffer): Promise<AudioData>;
}
