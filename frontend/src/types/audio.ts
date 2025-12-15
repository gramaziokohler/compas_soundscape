/**
 * Audio System Types
 *
 * Unified type definitions for the audio system.
 * Consolidated from multiple sources for consistency.
 */

import * as THREE from "three";

/* ========================================
 * POSITION & ORIENTATION TYPES
 * ======================================== */

// Standard position type - use THREE.Vector3 everywhere
export type Position = THREE.Vector3;

// Position tuple for interfaces that need array format
export type PositionTuple = [number, number, number];

/**
 * Sound Metadata
 * Lightweight metadata structure for sound tracking (replaces THREE.PositionalAudio)
 * All actual audio processing is handled by AudioOrchestrator
 */
export interface SoundMetadata {
  soundId: string;
  buffer: AudioBuffer;
  position: Position3D;
  soundEvent: {
    id: string;
    display_name: string;
    color?: string;
    prompt_index?: number;
    [key: string]: any; // Allow additional metadata
  };
}

export interface ScheduledSound {
  metadata: SoundMetadata;
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
export type AmbisonicOrder = 1 | 2 | 3; // First-order, Second-order, or Third-order

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

/**
 * ShoeBox Acoustics Types (Google Resonance Audio)
 */

// Room materials for ShoeBox Acoustics
export interface ResonanceRoomMaterial {
  left: string;
  right: string;
  front: string;
  back: string;
  down: string;
  up: string;
}

// Room dimensions for ShoeBox Acoustics (meters)
export interface ResonanceRoomDimensions {
  width: number;   // X dimension
  height: number;  // Y dimension
  depth: number;   // Z dimension
}

// ShoeBox Acoustics source configuration
export interface ResonanceSourceConfig {
  gain?: number;                    // Source volume (0-1)
  rolloff?: string;                 // Distance attenuation model ('logarithmic', 'linear', 'none')
  minDistance?: number;             // Minimum distance for attenuation (meters)
  maxDistance?: number;             // Maximum distance for attenuation (meters)
  directivityPattern?: number;      // Directivity pattern (0 = omnidirectional, 1 = cardioid)
  directivitySharpness?: number;    // Directivity sharpness (0-1)
}

// ShoeBox Acoustics configuration
export interface ResonanceAudioConfig {
  enabled: boolean;
  ambisonicOrder?: number;          // 1, 2, or 3 (default: 3)
  roomDimensions: ResonanceRoomDimensions;
  roomMaterials: ResonanceRoomMaterial;
}

/* ========================================
 * AUDIO MODE & ORCHESTRATION TYPES
 * ======================================== */

/**
 * Audio rendering modes
 * Defines how audio sources are processed and spatialized
 */
export enum AudioMode {
  // No IR modes (6 DOF)
  NO_IR_RESONANCE = 'no_ir_resonance',  // ShoeBox Acoustics (synthetic room)
  ANECHOIC = 'anechoic',                // No Acoustics - Dry source → ambisonic encoder → binaural decoder

  // IR modes (3 DOF rotation, static position)
  MONO_IR = 'mono_ir',                  // Mono IR → convolver → encoder → decoder
  STEREO_IR = 'stereo_ir',              // Stereo IR → L/R split → encode → decoder
  AMBISONIC_IR = 'ambisonic_ir'         // FOA/TOA IR → convolver → rotator → decoder
}

/**
 * Output decoder types
 * Note: Binaural-only in current workflow (stereo removed)
 */
export enum OutputDecoderType {
  BINAURAL_HRTF = 'binaural_hrtf'     // HRTF-based binaural for headphones
}

/**
 * Source-Receiver IR Mapping
 * Maps source IDs to receiver IDs to their corresponding IR metadata
 * Used for simulation-based acoustics (PyroomAcoustics, Choras)
 */
export interface SourceReceiverIRMapping {
  [sourceId: string]: {
    [receiverId: string]: ImpulseResponseMetadata;
  };
}

/**
 * Acoustic simulation mode types
 * Indicates which simulation engine generated the IRs
 */
export type AcousticSimulationMode = 'none' | 'pyroomacoustics' | 'choras';

/**
 * Audio mode configuration
 */
export interface AudioModeConfig {
  mode: AudioMode;
  irMetadata?: ImpulseResponseMetadata;  // Required for IR modes (manual IR upload)
  ambisonicOrder: 1 | 2 | 3;             // FOA, SOA, or TOA
  simulationMode?: AcousticSimulationMode; // Indicates simulation-based IR mode
  sourceReceiverIRMapping?: SourceReceiverIRMapping; // Source-receiver IR mapping for simulations
  activeReceiverId?: string; // Currently active receiver ID
}

/**
 * Orchestrator status for UI display
 */
export interface OrchestratorStatus {
  currentMode: AudioMode;
  isReceiverModeActive: boolean;
  isIRActive: boolean;
  ambisonicOrder: 1 | 2 | 3;
  dofDescription: string;
  uiNotice: string | null;
}

/**
 * Auralization Configuration (Legacy Compatibility)
 * Used for UI components that still expect this format
 */
export interface AuralizationConfig {
  enabled: boolean;
  impulseResponseUrl: string | null;
  impulseResponseBuffer: AudioBuffer | null;
  impulseResponseFilename: string | null;
  normalize: boolean;
}

/**
 * WAV Parse Result (for custom WAV parser)
 */
export interface WAVParseResult {
  sampleRate: number;
  numberOfChannels: number;
  bitsPerSample: number;
  audioData: Float32Array[];
}

