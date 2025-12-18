/**
 * IBinauralDecoder Interface
 *
 * Binaural decoder for ambisonic to stereo conversion.
 * Uses HRTF-based processing for accurate 3D audio on headphones.
 *
 * Supports:
 * - FOA (First-Order Ambisonics, 4 channels)
 * - SOA (Second-Order Ambisonics, 9 channels)
 * - TOA (Third-Order Ambisonics, 16 channels)
 */

import type { Orientation } from '@/types/audio';

export interface IBinauralDecoder {
  /**
   * Initialize decoder with audio context
   * @param audioContext - Web Audio API context
   * @param order - Ambisonic order (1 = FOA, 2 = SOA, 3 = TOA)
   * @param sofahrtfUrl - Optional path to SOFA HRTF file
   */
  initialize(
    audioContext: AudioContext,
    order: 1 | 2 | 3,
    sofahrtfUrl?: string
  ): Promise<void>;

  /**
   * Set ambisonic order (switch between FOA, SOA, TOA)
   * @param order - 1 for FOA (4ch), 2 for SOA (9ch), 3 for TOA (16ch)
   */
  setOrder(order: 1 | 2 | 3): Promise<void>;

  /**
   * Get input node for connecting ambisonic streams
   * @returns AudioNode accepting ambisonic channels (4 , 9 or 16)
   */
  getInputNode(): AudioNode;

  /**
   * Get output node for connecting to audio destination
   * @returns AudioNode outputting stereo (2ch)
   */
  getOutputNode(): AudioNode;

  /**
   * Enable or disable rotation tracking
   * - Enable for AmbisonicIRMode (IR contains fixed spatial encoding, need to rotate field)
   * - Disable for AnechoicMode (sources re-encoded in listener-local coordinates)
   * @param enabled - true to enable rotation, false to disable
   */
  setRotationEnabled(enabled: boolean): void;

  /**
   * Update listener orientation for head rotation
   * @param orientation - Euler angles (yaw, pitch, roll) in radians
   */
  updateOrientation(orientation: Orientation): void;

  /**
   * Check if decoder is ready for audio processing
   * @returns true if initialized and HRTF loaded
   */
  isReady(): boolean;

  /**
   * Get current ambisonic order
   * @returns 1 (FOA), 2 (SOA), or 3 (TOA)
   */
  getOrder(): 1 | 2 | 3;

  /**
   * Dispose of all resources
   */
  dispose(): void;
}
