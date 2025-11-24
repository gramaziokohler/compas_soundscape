/**
 * BinauralDecoder
 *
 * HRTF-based binaural decoder for ambisonic audio.
 * Converts FOA (4-ch), SOA (9-ch) or TOA (16-ch) ambisonics to stereo for headphones.
 *
 * Implementation:
 * - Wraps JSAmbisonics binDecoder for HRTF convolution
 * - Wraps JSAmbisonics sceneRotator for head rotation
 * - Supports order switching (FOA ↔ SOA ↔ TOA)
 * - Uses JSAmbisonics default cardioid virtual microphone method
 * - Handles real-time head rotation updates
 *
 * Physical Accuracy:
 * - HRTF convolution per ambisonic channel
 * - Encodes ITD and ILD for proper localization
 * - Head tracking via ambisonic field rotation
 * - All paths → ambisonic → rotator → binaural workflow
 *
 * Workflow:
 * [Ambisonic Input] → SceneRotator → BinDecoder → [Stereo Output]
 *                         ↑
 *                   Orientation updates
 */

import type { IBinauralDecoder } from '../core/interfaces/IBinauralDecoder';
import type { Orientation } from '@/types/audio';
import { JSAmbisonicDecoder } from '../jsambisonic-decoder';
import { loadIRCAMHRIRWithRetry } from '../utils/hrir-loader-ircam';
import { HRTF } from '@/lib/constants';

// JSAmbisonics type declarations
interface AmbisonicsLibrary {
  sceneRotator: new (audioContext: AudioContext, order: number) => {
    in: AudioNode;
    out: AudioNode;
    yaw: number;
    pitch: number;
    roll: number;
    updateRotMtx(): void;
  };
}

export class BinauralDecoder implements IBinauralDecoder {
  private audioContext: AudioContext | null = null;
  private jsAmbisonicDecoder: JSAmbisonicDecoder | null = null;
  private sceneRotator: any = null;
  private order: 1 | 2 | 3 = 1; // Default to FOA
  private ready: boolean = false;
  private _rotationLogCounter: number = 0;
  private rotationOffset: number = 0; // Yaw offset in radians
  private rotationEnabled: boolean = false; // Enable for AmbisonicIRMode, disable for AnechoicMode

  // Audio nodes
  private inputNode: AudioNode | null = null; // Rotator input
  private outputNode: AudioNode | null = null; // Decoder output

  /**
   * Initialize decoder with audio context
   */
  async initialize(
    audioContext: AudioContext,
    order: 1 | 2 | 3 = 1
  ): Promise<void> {
    this.audioContext = audioContext;
    this.order = order;

    try {
      console.log(`[BinauralDecoder] Initializing (order ${order})`);

      // Create JSAmbisonics scene rotator for head tracking
      // Use dynamic import to match AmbisonicIRMode and avoid SSR/module mismatch issues
      const ambisonics = await import('ambisonics');
      // @ts-ignore - Type definition mismatch for dynamic import
      this.sceneRotator = new ambisonics.sceneRotator(audioContext, order);

      console.log(`[BinauralDecoder] SceneRotator created:`, {
        hasIn: !!this.sceneRotator.in,
        hasOut: !!this.sceneRotator.out,
        hasUpdateRotMtx: typeof this.sceneRotator.updateRotMtx === 'function',
        order: order
      });

      // Initialize rotation to zero
      this.sceneRotator.yaw = 0;
      this.sceneRotator.pitch = 0;
      this.sceneRotator.roll = 0;
      this.sceneRotator.updateRotMtx();

      // Create JSAmbisonics binaural decoder (uses default cardioid HRTFs)
      // Pass the loaded ambisonics library to ensure consistency
      this.jsAmbisonicDecoder = new JSAmbisonicDecoder(audioContext, order, ambisonics);

      // Connect: Rotator → Decoder
      this.sceneRotator.out.connect(this.jsAmbisonicDecoder.input);

      // Set input/output nodes
      this.inputNode = this.sceneRotator.in; // Input goes to rotator
      this.outputNode = this.jsAmbisonicDecoder.output; // Output comes from decoder

      this.ready = true;
      console.log('[BinauralDecoder] Initialized successfully with head tracking (using default cardioid HRTFs)');
      console.log(`[BinauralDecoder] Audio path: INPUT (sceneRotator.in) → sceneRotator → decoder → OUTPUT`);

      // Auto-load HRTFs if enabled
      if (HRTF.AUTO_LOAD) {
        console.info('[BinauralDecoder] Auto-loading IRCAM HRTFs...');
        this.autoLoadHRTFs();
      } else {
        console.info('[BinauralDecoder] Using default cardioid virtual microphone decoding.');
        console.info('[BinauralDecoder] For HRTF-based decoding, use loadHRTFs() or enable HRTF.AUTO_LOAD');
      }
    } catch (error) {
      console.error('[BinauralDecoder] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Auto-load HRTFs in the background (non-blocking)
   * Called automatically during initialization if HRTF.AUTO_LOAD is true
   * @private
   */
  private async autoLoadHRTFs(): Promise<void> {
    try {
      await this.loadHRTFs();
      console.log('[BinauralDecoder] Auto-loaded HRTFs successfully');
    } catch (error) {
      console.warn('[BinauralDecoder] Failed to auto-load HRTFs, continuing with default cardioid decoding:', error);
    }
  }

  /**
   * Set ambisonic order (switch between FOA, SOA, TOA)
   * Recreates decoder and rotator with new order
   */
  async setOrder(order: 1 | 2 | 3): Promise<void> {
    if (order === this.order || !this.audioContext) {
      return;
    }

    console.log(`[BinauralDecoder] Switching from order ${this.order} to ${order}`);

    // Disconnect old rotator and decoder
    if (this.sceneRotator) {
      this.sceneRotator.out.disconnect();
    }
    if (this.jsAmbisonicDecoder) {
      this.jsAmbisonicDecoder.disconnect();
    }

    // Create new decoder and rotator with new order
    this.order = order;
    await this.initialize(this.audioContext, order);
  }

  /**
   * Get input node for connecting ambisonic streams
   */
  getInputNode(): AudioNode {
    if (!this.inputNode) {
      throw new Error('[BinauralDecoder] Not initialized - call initialize() first');
    }
    return this.inputNode;
  }

  /**
   * Get output node for connecting to destination
   */
  getOutputNode(): AudioNode {
    if (!this.outputNode) {
      throw new Error('[BinauralDecoder] Not initialized - call initialize() first');
    }
    return this.outputNode;
  }

  /**
   * Set rotation offset (yaw) to align the scene
   * @param offsetRadians - Offset in radians
   */
  setRotationOffset(offsetRadians: number): void {
    this.rotationOffset = offsetRadians;
  }

  /**
   * Enable or disable rotation tracking
   * - Enable for AmbisonicIRMode (IR contains fixed spatial encoding, need to rotate field)
   * - Disable for AnechoicMode (sources re-encoded in listener-local coordinates)
   */
  setRotationEnabled(enabled: boolean): void {
    this.rotationEnabled = enabled;
    console.log(`[BinauralDecoder] Rotation ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update listener orientation
   *
   * Behavior depends on rotationEnabled:
   * - Disabled (AnechoicMode): Keep at identity, encoding handles orientation
   * - Enabled (AmbisonicIRMode): Apply rotation to ambisonic field for head tracking
   *
   * JSAmbisonics sceneRotator expects degrees, Orientation provides radians.
   */
  updateOrientation(orientation: Orientation): void {
    if (!this.sceneRotator) {
      return;
    }

    if (!this.rotationEnabled) {
      // AnechoicMode: Keep rotator at identity - encoding handles orientation
      this.sceneRotator.yaw = 0;
      this.sceneRotator.pitch = 0;
      this.sceneRotator.roll = 0;
    } else {
      // AmbisonicIRMode: Apply rotation for head tracking
      // Convert radians to degrees, apply rotation offset for scene alignment
      // NEGATE yaw/pitch for head tracking: when head looks left, scene rotates right
      const RAD_TO_DEG = 180 / Math.PI;
      const yawDeg = -(orientation.yaw * RAD_TO_DEG + this.rotationOffset * RAD_TO_DEG);
      const pitchDeg = -(orientation.pitch * RAD_TO_DEG);

      this.sceneRotator.yaw = yawDeg;
      this.sceneRotator.pitch = pitchDeg;
      this.sceneRotator.roll = 0; // Roll typically not used for head tracking

      // Debug logging (throttled)
      if (this._rotationLogCounter++ % 60 === 0) {
        console.log(`[BinauralDecoder] Rotation: yaw=${yawDeg.toFixed(1)}°, pitch=${pitchDeg.toFixed(1)}°`);
      }
    }

    this.sceneRotator.updateRotMtx();
  }

  /**
   * Check if decoder is ready
   */
  isReady(): boolean {
    return this.ready && this.inputNode !== null && this.outputNode !== null;
  }

  /**
   * Get current ambisonic order
   */
  getOrder(): 1 | 2 | 3 {
    return this.order;
  }

  /**
   * Load HRTF data for improved spatial accuracy
   *
   * Loads IRCAM-formatted SOFA HRTFs and generates ambisonic decoding filters.
   * The HRIR loader automatically:
   * - Selects optimal virtual speaker positions based on ambisonic order
   * - Finds nearest measured HRTFs to each virtual speaker
   * - Generates multi-channel AudioBuffer with (order+1)^2 * 2 channels
   *
   * Channel layout: [L0, R0, L1, R1, L2, R2, ...]
   * - FOA (order 1): 8 channels (4 virtual speakers × 2 ears)
   * - SOA (order 2): 18 channels (9 virtual speakers × 2 ears)
   * - TOA (order 3): 32 channels (16 virtual speakers × 2 ears)
   *
   * @param path - Optional custom HRTF path (defaults to HRTF.DEFAULT_HRTF_PATH)
   */
  async loadHRTFs(path?: string): Promise<void> {
    if (!this.audioContext || !this.jsAmbisonicDecoder) {
      throw new Error('[BinauralDecoder] Cannot load HRTFs - decoder not initialized');
    }

    try {
      console.log('[BinauralDecoder] Loading IRCAM HRTF data...');
      const hrtfPath = path || HRTF.DEFAULT_HRTF_PATH;

      // Load IRCAM HRIR and generate ambisonic decoding filters
      const hrtfBuffer = await loadIRCAMHRIRWithRetry(
        this.audioContext,
        hrtfPath,
        this.order
      );

      // Validate channel count
      // IRCAM loader produces (order+1)^2 * 2 channels (L/R pairs for each virtual speaker)
      const expectedSpeakers = Math.pow(this.order + 1, 2);
      const expectedChannels = expectedSpeakers * 2; // L/R pairs

      if (hrtfBuffer.numberOfChannels !== expectedChannels) {
        console.warn(
          `[BinauralDecoder] HRTF buffer has ${hrtfBuffer.numberOfChannels} channels, ` +
          `expected ${expectedChannels} for order ${this.order}`
        );
      }

      // Re-check after async operation (decoder may have been disposed during loading)
      if (!this.jsAmbisonicDecoder) {
        console.warn('[BinauralDecoder] Decoder was disposed during HRTF loading, aborting');
        return;
      }

      // Apply HRTFs to decoder
      await this.jsAmbisonicDecoder.loadHRTFs(hrtfBuffer);

      console.log(
        `[BinauralDecoder] HRTFs loaded successfully - now using measured IRCAM HRTFs for binaural decoding ` +
        `(${expectedSpeakers} virtual speakers, ${hrtfBuffer.numberOfChannels} channels)`
      );
    } catch (error) {
      console.error('[BinauralDecoder] Failed to load HRTFs:', error);
      throw error;
    }
  }

  /**
   * Check if custom HRTFs are loaded
   */
  hasHRTFs(): boolean {
    return this.jsAmbisonicDecoder?.hasHRTFs() ?? false;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    console.log('[BinauralDecoder] Disposing');

    // Disconnect rotator
    if (this.sceneRotator) {
      try {
        this.sceneRotator.out.disconnect();
      } catch (error) {
        console.warn('[BinauralDecoder] Error disconnecting rotator:', error);
      }
      this.sceneRotator = null;
    }

    // Disconnect decoder
    if (this.jsAmbisonicDecoder) {
      this.jsAmbisonicDecoder.disconnect();
      this.jsAmbisonicDecoder = null;
    }

    this.inputNode = null;
    this.outputNode = null;
    this.audioContext = null;
    this.ready = false;
  }
}
