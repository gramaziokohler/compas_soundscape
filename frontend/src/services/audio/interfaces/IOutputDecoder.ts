/**
 * IOutputDecoder Interface
 *
 * Defines the contract for output decoding implementations.
 * Supports binaural (HRTF) and stereo speaker decoding.
 */

import type { OutputDecoderType } from '../types';

export interface IOutputDecoder {
  /**
   * Initialize decoder with audio context
   */
  initialize(audioContext: AudioContext): void;

  /**
   * Get the input node for connecting audio sources
   */
  getInputNode(): AudioNode;

  /**
   * Get the output node for connecting to destination
   */
  getOutputNode(): AudioNode;

  /**
   * Update decoder orientation (for HRTF)
   * @param orientation - Euler angles [yaw, pitch, roll] in radians
   */
  updateOrientation(orientation: [number, number, number]): void;

  /**
   * Get decoder type
   */
  getType(): OutputDecoderType;

  /**
   * Clean up resources
   */
  dispose(): void;
}
