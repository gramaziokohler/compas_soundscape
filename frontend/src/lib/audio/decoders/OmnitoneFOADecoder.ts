/**
 * OmnitoneFOADecoder
 *
 * Google Omnitone-based FOA (First Order Ambisonics) decoder for spatial audio.
 * Converts 4-channel FOA streams to binaural stereo for headphones.
 *
 * Key Features:
 * - Uses Google Omnitone's optimized FOA rendering
 * - Built-in HRTF processing (no external HRTF loading required)
 * - Ambisonic rotation for head tracking
 * - Lightweight and efficient convolution
 * - Supports both MediaElement and AudioBufferSource inputs
 *
 * Implementation:
 * - Wraps Omnitone.createFOARenderer()
 * - Uses Web Audio API convolution for spatial rendering
 * - Based on Google spatial media specification
 * - Uses SADIE binaural filters
 *
 * Physical Accuracy:
 * - First-order ambisonic decoding (4 channels: W, X, Y, Z)
 * - HRTF-based binaural rendering
 * - Accurate ITD (Interaural Time Difference) and ILD (Interaural Level Difference)
 * - Real-time head rotation via rotation matrix updates
 *
 * Workflow:
 * [FOA Input (4ch)] → Omnitone FOARenderer → [Stereo Output (2ch)]
 *                           ↑
 *                    Rotation Matrix
 *
 * @see https://github.com/GoogleChrome/omnitone
 */

import type { IBinauralDecoder } from '../core/interfaces/IBinauralDecoder';
import type { Orientation } from '@/types/audio';
import type { FOARenderer } from 'omnitone';

export class OmnitoneFOADecoder implements IBinauralDecoder {
  private audioContext: AudioContext | null = null;
  private foaRenderer: FOARenderer | null = null;
  private order: 1 | 2 | 3 = 1; // Always FOA (First Order = 1)
  private ready: boolean = false;
  private rotationEnabled: boolean = false;

  // Current orientation (cached for matrix calculation)
  private currentOrientation: Orientation = {
    yaw: 0,
    pitch: 0,
    roll: 0
  };

  /**
   * Initialize FOA decoder with audio context
   * Omnitone only supports FOA (order 1), so order parameter is enforced to 1
   */
  async initialize(
    audioContext: AudioContext,
    order: 1 | 2 | 3 = 1
  ): Promise<void> {
    if (order !== 1) {
      console.warn(
        `[OmnitoneFOADecoder] Omnitone only supports FOA (order 1). ` +
        `Requested order ${order} will be ignored. Use BinauralDecoder for higher orders.`
      );
    }

    this.audioContext = audioContext;
    this.order = 1; // Force FOA

    try {
      console.log('[OmnitoneFOADecoder] Initializing Omnitone FOA renderer');

      // Dynamically import Omnitone ES module to avoid SSR issues
      // Must use the .esm.js build which has proper ES module exports
      const OmnitoneModule = await import('omnitone/build/omnitone.esm.js');
      const Omnitone = OmnitoneModule.default;

      // Create FOA renderer with default configuration
      this.foaRenderer = Omnitone.createFOARenderer(audioContext);

      if (!this.foaRenderer) {
        throw new Error('[OmnitoneFOADecoder] Failed to create FOARenderer');
      }

      console.log('[OmnitoneFOADecoder] FOARenderer created:', {
        hasInput: !!this.foaRenderer.input,
        hasOutput: !!this.foaRenderer.output,
        hasInitialize: typeof this.foaRenderer.initialize === 'function'
      });

      // Initialize renderer (loads HRTF data internally)
      await this.foaRenderer.initialize();

      // Set to ambisonic rendering mode (vs bypass or off)
      this.foaRenderer.setRenderingMode('ambisonic');

      this.ready = true;
      console.log('[OmnitoneFOADecoder] Initialized successfully with built-in SADIE HRTFs');
      console.log('[OmnitoneFOADecoder] Audio path: INPUT (4ch FOA) → FOARenderer → OUTPUT (stereo)');
    } catch (error) {
      console.error('[OmnitoneFOADecoder] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set ambisonic order
   * Note: Omnitone only supports FOA (order 1), so this will log a warning for other orders
   */
  async setOrder(order: 1 | 2 | 3): Promise<void> {
    if (order !== 1) {
      console.warn(
        `[OmnitoneFOADecoder] Cannot change order - Omnitone only supports FOA (order 1). ` +
        `Requested order ${order} ignored.`
      );
      return;
    }

    // Already at order 1, nothing to do
    console.log('[OmnitoneFOADecoder] Order is already 1 (FOA)');
  }

  /**
   * Get input node for connecting ambisonic streams
   * Returns the FOARenderer's input GainNode (expects 4 channels)
   */
  getInputNode(): AudioNode {
    if (!this.foaRenderer) {
      throw new Error('[OmnitoneFOADecoder] Not initialized - call initialize() first');
    }
    return this.foaRenderer.input;
  }

  /**
   * Get output node for connecting to destination
   * Returns the FOARenderer's output GainNode (stereo)
   */
  getOutputNode(): AudioNode {
    if (!this.foaRenderer) {
      throw new Error('[OmnitoneFOADecoder] Not initialized - call initialize() first');
    }
    return this.foaRenderer.output;
  }

  /**
   * Enable or disable rotation tracking
   * - Enable for AmbisonicIRMode (IR contains fixed spatial encoding, rotate field for head tracking)
   * - Disable for AnechoicMode (sources re-encoded in listener-local coordinates)
   */
  setRotationEnabled(enabled: boolean): void {
    this.rotationEnabled = enabled;
    console.log(`[OmnitoneFOADecoder] Rotation ${enabled ? 'enabled' : 'disabled'}`);

    // If disabling, reset to identity rotation
    if (!enabled && this.foaRenderer) {
      const identityMatrix = [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
      ];
      this.foaRenderer.setRotationMatrix3(identityMatrix);
    }
  }

  /**
   * Update listener orientation for head tracking
   *
   * Converts Orientation (yaw, pitch, roll in radians) to 3x3 rotation matrix
   * and applies it to the Omnitone FOA renderer.
   *
   * Behavior depends on rotationEnabled:
   * - Disabled (AnechoicMode): Keep at identity, encoding handles orientation
   * - Enabled (AmbisonicIRMode): Apply rotation to ambisonic field for head tracking
   *
   * Rotation order: Yaw (Y-axis) → Pitch (X-axis) → Roll (Z-axis)
   * Matrix is column-major format expected by Omnitone
   */
  updateOrientation(orientation: Orientation): void {
    if (!this.foaRenderer) {
      return;
    }

    this.currentOrientation = orientation;

    if (!this.rotationEnabled) {
      // AnechoicMode: Keep rotator at identity
      const identityMatrix = [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
      ];
      this.foaRenderer.setRotationMatrix3(identityMatrix);
      return;
    }

    // AmbisonicIRMode: Apply rotation for head tracking
    // Negate pitch for head tracking: when head looks up, scene rotates down
    const yaw = orientation.yaw;
    const pitch = orientation.pitch;
    const roll = orientation.roll;

    // Compute rotation matrix (column-major, 3x3)
    // R = Rz(roll) * Rx(pitch) * Ry(yaw)
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosRoll = Math.cos(roll);
    const sinRoll = Math.sin(roll);

    // Combined rotation matrix (column-major format)
    const matrix = [
      // Column 1
      cosYaw * cosRoll - sinYaw * sinPitch * sinRoll,
      cosYaw * sinRoll + sinYaw * sinPitch * cosRoll,
      -sinYaw * cosPitch,

      // Column 2
      -cosPitch * sinRoll,
      cosPitch * cosRoll,
      sinPitch,

      // Column 3
      sinYaw * cosRoll + cosYaw * sinPitch * sinRoll,
      sinYaw * sinRoll - cosYaw * sinPitch * cosRoll,
      cosYaw * cosPitch
    ];

    this.foaRenderer.setRotationMatrix3(matrix);
  }

  /**
   * Check if decoder is ready for audio processing
   */
  isReady(): boolean {
    return this.ready && this.foaRenderer !== null;
  }

  /**
   * Get current ambisonic order (always 1 for FOA)
   */
  getOrder(): 1 | 2 | 3 {
    return 1; // Always FOA
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    console.log('[OmnitoneFOADecoder] Disposing');

    // Disconnect renderer nodes
    if (this.foaRenderer) {
      try {
        this.foaRenderer.setRenderingMode('off');
        // Note: Omnitone doesn't expose a dispose() method,
        // but setting mode to 'off' disables processing
      } catch (error) {
        console.warn('[OmnitoneFOADecoder] Error disposing renderer:', error);
      }
      this.foaRenderer = null;
    }

    this.audioContext = null;
    this.ready = false;
  }
}
