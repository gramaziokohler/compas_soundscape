/**
 * Audio System Types
 *
 * Extracted from audio-scheduler.ts
 */

import * as THREE from "three";

export interface ScheduledSound {
  audio: THREE.PositionalAudio;
  intervalMs: number;
  randomnessPercent: number;
  timerId: NodeJS.Timeout | null;
  isScheduled: boolean;
}

export interface WAVHeader {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

export interface WAVParseResult {
  sampleRate: number;
  numberOfChannels: number;
  bitsPerSample: number;
  audioData: Float32Array[];
}
