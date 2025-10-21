/**
 * Auralization Types
 *
 * Extracted from useAuralization.ts
 */

export interface AuralizationConfig {
  enabled: boolean;
  impulseResponseUrl: string | null;
  impulseResponseBuffer: AudioBuffer | null;
  normalize: boolean;
}

export interface WAVParseResult {
  sampleRate: number;
  numberOfChannels: number;
  bitsPerSample: number;
  audioData: Float32Array[];
}
