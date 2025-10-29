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
  initialDelayMs: number; // Initial delay before first playback
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

/**
 * Timeline Types
 */

export interface TimelineSound {
  id: string;
  displayName: string;
  color: string;
  intervalMs: number;
  soundDurationMs: number;
  scheduledIterations: number[]; // Array of timestamps (ms) when sound will play
  audioUrl?: string; // Optional audio URL for WaveSurfer waveform visualization
}

export interface TimelinePlaybackState {
  isPlaying: boolean;
  currentTime: number; // Current playback time in milliseconds
  duration: number; // Total timeline duration in milliseconds
}
