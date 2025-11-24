/**
 * WAV File Parser
 *
 * Utility for parsing WAV audio files manually.
 * Handles multi-channel WAV files that browsers can't decode natively.
 *
 * Extracted from useAuralization.ts to centralize WAV parsing logic.
 */

import type { WAVParseResult } from "@/types/audio";

/**
 * Parse WAV file header and extract audio data.
 *
 * Manually parses WAV file format to extract audio samples.
 * Supports multi-channel files (mono, stereo, surround).
 *
 * @param arrayBuffer - The WAV file as ArrayBuffer
 * @returns Parsed WAV data with samples for each channel
 * @throws Error if file is not a valid WAV or unsupported format
 *
 * Supported formats:
 * - PCM (audioFormat = 1)
 * - 16, 24, or 32-bit samples
 * - Any number of channels
 */
export function parseWAVFile(arrayBuffer: ArrayBuffer): WAVParseResult {
  const view = new DataView(arrayBuffer);

  // Check RIFF header (bytes 0-3)
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }

  // Check WAVE format (bytes 8-11)
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );
  if (wave !== 'WAVE') {
    throw new Error('Not a valid WAV file (missing WAVE format)');
  }

  let offset = 12;
  let fmt: any = null;
  let dataOffset = 0;
  let dataSize = 0;

  // Parse chunks
  while (offset < view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      // Parse format chunk
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        numberOfChannels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (!fmt) {
    throw new Error('WAV file missing format chunk');
  }

  if (dataOffset === 0) {
    throw new Error('WAV file missing data chunk');
  }

  // Only support PCM format (audioFormat = 1)
  if (fmt.audioFormat !== 1) {
    throw new Error(
      `Unsupported WAV format: ${fmt.audioFormat} (only PCM is supported)`
    );
  }

  console.log('[WAV Parser] Format:', fmt);
  console.log('[WAV Parser] Data offset:', dataOffset, 'size:', dataSize);

  // Calculate number of samples
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numberOfChannels * bytesPerSample;
  const numSamples = Math.floor(dataSize / blockAlign);

  console.log('[WAV Parser] Samples per channel:', numSamples);

  // Extract audio data for each channel
  const audioData: Float32Array[] = [];
  for (let ch = 0; ch < fmt.numberOfChannels; ch++) {
    audioData.push(new Float32Array(numSamples));
  }

  // Read interleaved samples
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < fmt.numberOfChannels; ch++) {
      const sampleOffset = dataOffset + i * blockAlign + ch * bytesPerSample;
      let sample = 0;

      if (fmt.bitsPerSample === 16) {
        sample = view.getInt16(sampleOffset, true) / 32768.0;
      } else if (fmt.bitsPerSample === 24) {
        const byte1 = view.getUint8(sampleOffset);
        const byte2 = view.getUint8(sampleOffset + 1);
        const byte3 = view.getInt8(sampleOffset + 2);
        sample = ((byte3 << 16) | (byte2 << 8) | byte1) / 8388608.0;
      } else if (fmt.bitsPerSample === 32) {
        sample = view.getInt32(sampleOffset, true) / 2147483648.0;
      } else {
        throw new Error(`Unsupported bit depth: ${fmt.bitsPerSample}`);
      }

      audioData[ch][i] = sample;
    }
  }

  return {
    sampleRate: fmt.sampleRate,
    numberOfChannels: fmt.numberOfChannels,
    bitsPerSample: fmt.bitsPerSample,
    audioData,
  };
}

/**
 * Convert WAV parse result to AudioBuffer.
 *
 * Creates a Web Audio API AudioBuffer from parsed WAV data.
 *
 * @param wavData - Parsed WAV data
 * @param audioContext - Web Audio API context
 * @returns AudioBuffer ready for playback
 */
export function createAudioBufferFromWAV(
  wavData: WAVParseResult,
  audioContext: AudioContext
): AudioBuffer {
  const buffer = audioContext.createBuffer(
    wavData.numberOfChannels,
    wavData.audioData[0].length,
    wavData.sampleRate
  );

  // Copy data to buffer channels
  for (let ch = 0; ch < wavData.numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    channelData.set(wavData.audioData[ch]);
  }

  return buffer;
}
