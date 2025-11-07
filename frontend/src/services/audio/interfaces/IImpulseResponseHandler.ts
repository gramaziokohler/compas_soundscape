/**
 * IImpulseResponseHandler Interface
 *
 * Handles loading, decoding, and metadata extraction for impulse responses.
 */

import type { IRMetadata } from '../types';

export interface IImpulseResponseHandler {
  /**
   * Load and decode impulse response from file
   * @param file - IR audio file
   * @param audioContext - Web Audio API context
   * @returns IR metadata
   */
  loadIR(file: File, audioContext: AudioContext): Promise<IRMetadata>;

  /**
   * Get current IR buffer
   */
  getIRBuffer(): AudioBuffer | null;

  /**
   * Get IR metadata
   */
  getIRMetadata(): IRMetadata | null;

  /**
   * Clear loaded IR
   */
  clearIR(): void;
}
