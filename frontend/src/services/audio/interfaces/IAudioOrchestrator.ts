/**
 * IAudioOrchestrator Interface
 *
 * Central coordinator for audio rendering modes and output decoding.
 * Manages transitions between different rendering strategies.
 */

import type {
  AudioRenderMode,
  AudioSourceHandle,
  OutputDecoderType,
  RenderingModeConfig,
  OrchestratorStatus
} from '../types';

export interface IAudioOrchestrator {
  /**
   * Initialize orchestrator
   */
  initialize(audioContext: AudioContext): void;

  /**
   * Set current rendering mode based on IR and user preferences
   */
  setRenderingMode(config: RenderingModeConfig): void;

  /**
   * Set output decoder type
   */
  setOutputDecoder(type: OutputDecoderType): void;

  /**
   * Update receiver mode state
   */
  setReceiverMode(isActive: boolean, receiverId: string | null): void;

  /**
   * Create audio source
   */
  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle;

  /**
   * Update listener position and orientation
   */
  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void;

  /**
   * Get current rendering mode
   */
  getCurrentMode(): AudioRenderMode;

  /**
   * Get current status (for UI display)
   */
  getStatus(): OrchestratorStatus;

  /**
   * Clean up
   */
  dispose(): void;
}
