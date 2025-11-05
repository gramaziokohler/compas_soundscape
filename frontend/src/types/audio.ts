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

/**
 * Multi-Channel Auralization Types
 */

// IR Format types
export type IRFormat = "mono" | "binaural" | "foa" | "toa";

// Ambisonic order types
export type AmbisonicOrder = 1 | 3; // First-order or Third-order

// Impulse Response Metadata
export interface ImpulseResponseMetadata {
  id: string;
  url: string;
  name: string;
  format: IRFormat;
  channels: number; // 1, 2, 4, or 16
  originalChannels: number; // May be higher if file was truncated
  sampleRate: number;
  duration: number; // Duration in seconds
  fileSize: number; // Size in bytes
}

// Auralization Settings
export interface AuralizationSettings {
  enabled: boolean;
  irId: string | null;
  irFormat: IRFormat | null;
  wetGain: number; // 0-1
  dryGain: number; // 0-1
}

// Ambisonic Encoding Result
export interface AmbisonicEncodedBuffer {
  buffer: AudioBuffer;
  order: AmbisonicOrder;
  channels: number;
}

// 3D Position
export interface Position3D {
  x: number;
  y: number;
  z: number;
}

// Spherical Coordinates
export interface SphericalPosition {
  azimuth: number; // Radians, 0 = front, π/2 = left, π = back, -π/2 = right
  elevation: number; // Radians, π/2 = up, -π/2 = down, 0 = horizontal
  distance: number; // Meters
}

// Camera/Listener Orientation
export interface Orientation {
  yaw: number;   // Radians, rotation around Y-axis (left-right look)
  pitch: number; // Radians, rotation around X-axis (up-down look)
  roll: number;  // Radians, rotation around Z-axis (head tilt)
}

// Ambisonic Encoding Coefficients (FOA)
export interface FOACoefficients {
  W: number;
  X: number;
  Y: number;
  Z: number;
}

// Ambisonic Encoding Coefficients (TOA) - 16 coefficients
export type TOACoefficients = number[]; // Array of 16 values

