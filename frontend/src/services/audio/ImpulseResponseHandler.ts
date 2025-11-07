/**
 * Impulse Response Handler
 *
 * Handles loading, decoding, and format detection for impulse responses.
 */

import type { IImpulseResponseHandler } from './interfaces/IImpulseResponseHandler';
import type { IRMetadata } from './types';
import { IRFormatDetector } from './utils/IRFormatDetector';

export class ImpulseResponseHandler implements IImpulseResponseHandler {
  private irBuffer: AudioBuffer | null = null;
  private irMetadata: IRMetadata | null = null;

  async loadIR(file: File, audioContext: AudioContext): Promise<IRMetadata> {
    console.log('[ImpulseResponseHandler] Loading IR:', file.name);

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      console.log('[ImpulseResponseHandler] File loaded, size:', arrayBuffer.byteLength);

      // Decode audio data
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        console.log('[ImpulseResponseHandler] Decoded successfully:', {
          channels: audioBuffer.numberOfChannels,
          sampleRate: audioBuffer.sampleRate,
          duration: audioBuffer.duration
        });
      } catch (decodeError) {
        console.error('[ImpulseResponseHandler] Decode error details:', decodeError);
        // Check if it's a channel count issue
        if (decodeError instanceof Error && decodeError.message.includes('channel')) {
          throw new Error(`Failed to decode audio file. Your browser may not support ${Math.round(arrayBuffer.byteLength / 1000)}KB files with high channel counts. Try using a browser that supports multi-channel audio (Chrome/Edge recommended).`);
        }
        throw new Error(`Failed to decode audio file: ${decodeError instanceof Error ? decodeError.message : 'Unknown error'}. Please use a valid WAV, MP3, or OGG format.`);
      }

      // Validate audio buffer
      if (audioBuffer.length === 0) {
        throw new Error('Impulse response is empty');
      }

      // Detect format
      const format = IRFormatDetector.detect(audioBuffer);
      const renderMode = IRFormatDetector.getRenderMode(format);

      console.log(`[ImpulseResponseHandler] Detected format: ${format} (${audioBuffer.numberOfChannels} channels)`);

      // Create metadata
      const metadata: IRMetadata = {
        filename: file.name,
        format,
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration,
        fileSize: file.size,
        buffer: audioBuffer,
        renderMode
      };

      this.irBuffer = audioBuffer;
      this.irMetadata = metadata;

      return metadata;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error loading impulse response';
      console.error('[ImpulseResponseHandler] Error:', err);
      throw new Error(errorMessage);
    }
  }

  getIRBuffer(): AudioBuffer | null {
    return this.irBuffer;
  }

  getIRMetadata(): IRMetadata | null {
    return this.irMetadata;
  }

  clearIR(): void {
    this.irBuffer = null;
    this.irMetadata = null;
  }
}
