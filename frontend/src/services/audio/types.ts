/**
 * Audio Services Types
 *
 * Shared types for the modular audio rendering system.
 * Following Single Responsibility Principle.
 */

export enum AudioRenderMode {
  NO_IR_THREEJS = 'no_ir_threejs',
  NO_IR_RESONANCE = 'no_ir_resonance',
  MONO_IR = 'mono_ir',
  SPATIAL_IR_BINAURAL = 'spatial_ir_binaural',
  SPATIAL_IR_FOA = 'spatial_ir_foa',
  SPATIAL_IR_TOA = 'spatial_ir_toa'
}

export enum OutputDecoderType {
  BINAURAL_HRTF = 'binaural_hrtf',
  STEREO_SPEAKERS = 'stereo_speakers'
}

export type IRFormat = 'mono' | 'binaural' | 'foa' | 'toa';

export interface IRMetadata {
  filename: string;
  format: IRFormat;
  channels: number;
  sampleRate: number;
  duration: number;
  fileSize: number;
  buffer: AudioBuffer;
  renderMode: AudioRenderMode;
}

export interface RenderingModeConfig {
  irMetadata: IRMetadata | null;
  preferredNoIRMode: 'threejs' | 'resonance';
}

export interface OrchestratorStatus {
  currentMode: AudioRenderMode;
  isReceiverModeActive: boolean;
  isIRActive: boolean;
  outputDecoderType: OutputDecoderType;
  dofDescription: string;
  uiNotice: string | null;
}

export interface AudioSourceHandle {
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(volume: number): void;
  setPosition(position: [number, number, number]): void;
  connect(destination: AudioNode): void;
  disconnect(): void;
  getOutputNode(): AudioNode;
  dispose(): void;
}
