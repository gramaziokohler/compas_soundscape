/**
 * IAudioRenderer Interface
 *
 * Defines the contract for audio rendering implementations.
 * Supports different rendering strategies: No IR, Mono IR, Spatial IR.
 */

import type { AudioRenderMode, AudioSourceHandle } from '../types';

export interface IAudioRenderer {
  /**
   * Initialize the renderer with audio context
   */
  initialize(audioContext: AudioContext): void;

  /**
   * Create an audio source at a given position
   * @param position - 3D position [x, y, z]
   * @param audioBuffer - Audio buffer to play
   * @returns Audio source handle for control
   */
  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle;

  /**
   * Update listener position and orientation
   * @param position - 3D position [x, y, z]
   * @param orientation - Euler angles [yaw, pitch, roll] in radians
   */
  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void;

  /**
   * Enable or disable the renderer
   */
  setEnabled(enabled: boolean): void;

  /**
   * Check if receiver mode is required for this renderer
   */
  requiresReceiverMode(): boolean;

  /**
   * Get current renderer mode identifier
   */
  getMode(): AudioRenderMode;

  /**
   * Get the output node for connecting to next stage
   */
  getOutputNode(): AudioNode;

  /**
   * Clean up resources
   */
  dispose(): void;
}
