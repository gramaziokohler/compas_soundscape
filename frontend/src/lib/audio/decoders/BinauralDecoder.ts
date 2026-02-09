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
import { HRTF } from '@/utils/constants';

// JSAmbisonics binDecoder type
interface BinDecoder {
  in: AudioNode;
  out: AudioNode;
  updateFilters(buffer: AudioBuffer): void;
}

export class BinauralDecoder implements IBinauralDecoder {
  private audioContext: AudioContext | null = null;
  private binDecoder: BinDecoder | null = null;
  private sceneRotator: any = null;
  private hrirLoader: any = null; // JSAmbisonics HRIRloader_ircam
  private order: 1 | 2 | 3 = 1; // Default to FOA
  private ready: boolean = false;
  private _rotationLogCounter: number = 0;
  private rotationEnabled: boolean = false; // Enable for AmbisonicIRMode, disable for AnechoicMode
  private hrtfsLoaded: boolean = false;

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

      // Dynamic import JSAmbisonics to avoid SSR issues
      const ambisonics = await import('ambisonics');

      // Create JSAmbisonics scene rotator for head tracking
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

      // Create JSAmbisonics binaural decoder directly (uses default cardioid decoding)
      // @ts-ignore - Type definition mismatch for dynamic import
      this.binDecoder = new ambisonics.binDecoder(audioContext, order);

      // Connect: Rotator → Decoder
      this.sceneRotator.out.connect(this.binDecoder.in);

      // Set input/output nodes
      this.inputNode = this.sceneRotator.in; // Input goes to rotator
      this.outputNode = this.binDecoder.out; // Output comes from decoder

      this.ready = true;
      console.log('[BinauralDecoder] Initialized successfully with head tracking (using default cardioid decoding)');
      console.log(`[BinauralDecoder] Audio path: INPUT (sceneRotator.in) → sceneRotator → binDecoder → OUTPUT`);

      // Auto-load HRTFs if enabled (only for JSAmbisonics, Omnitone has built-in HRTFs)
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
    if (this.binDecoder) {
      try {
        this.binDecoder.out.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }

    // Reset HRTF state for new order
    this.hrtfsLoaded = false;

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
      // Convert radians to degrees
      // NEGATE pitch for head tracking: when head looks up, scene rotates down
      const RAD_TO_DEG = 180 / Math.PI;
      this.sceneRotator.yaw = orientation.yaw * RAD_TO_DEG;
      this.sceneRotator.pitch = (orientation.pitch * RAD_TO_DEG);
      this.sceneRotator.roll = 0; // Roll typically not used for head tracking

      // Debug logging (throttled)
      // if (this._rotationLogCounter++ % 60 === 0) {
      //   console.log(`[BinauralDecoder] Rotation: yaw=${this.sceneRotator.yaw.toFixed(1)}°, pitch=${this.sceneRotator.pitch.toFixed(1)}° (input: ${orientation.pitch.toFixed(3)} rad)`);
      // }
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
   * Uses JSAmbisonics' HRIRloader_ircam to load IRCAM SOFA HRTFs.
   * The loader automatically:
   * - Loads SOFA file and extracts HRIRs
   * - Generates proper ambisonic decoding filters for the order
   * - Updates the binDecoder with the new filters
   *
   * @param path - Optional custom HRTF path (defaults to HRTF.DEFAULT_HRTF_PATH)
   */
  async loadHRTFs(path?: string): Promise<void> {
    if (!this.audioContext || !this.binDecoder) {
      throw new Error('[BinauralDecoder] Cannot load HRTFs - decoder not initialized');
    }

    const hrtfPath = path || HRTF.DEFAULT_HRTF_PATH;
    console.log(`[BinauralDecoder] Loading IRCAM HRTFs from: ${hrtfPath}`);

    return new Promise(async (resolve, reject) => {
      try {
        // Dynamic import JSAmbisonics
        const ambisonics = await import('ambisonics');

        // Create IRCAM HRIR loader - it handles SOFA parsing and filter generation
        // JSAmbisonics HRIRloader_ircam passes the decoded HRIR buffer to the callback
        // @ts-ignore - Type definitions missing for ambisonics library
        this.hrirLoader = new ambisonics.HRIRloader_ircam(
          this.audioContext!,  // Non-null assertion - guard check at line 253 ensures this
          this.order,
          // @ts-ignore - Callback receives hoaBuffer but types are missing
          (hoaBuffer: AudioBuffer) => {
            // Callback when HRIRs are loaded
            if (!this.binDecoder) {
              console.warn('[BinauralDecoder] Decoder was disposed during HRTF loading');
              reject(new Error('Decoder disposed'));
              return;
            }

            // Update decoder with the loaded HRIR filters
            this.binDecoder.updateFilters(hoaBuffer);
            this.hrtfsLoaded = true;

            console.log(
              `[BinauralDecoder] HRTFs loaded successfully - using IRCAM HRTFs ` +
              `(order ${this.order}, ${hoaBuffer.numberOfChannels} channels)`
            );
            resolve();
          }
        );

        // Start loading the SOFA file
        this.hrirLoader.load(hrtfPath);
      } catch (error) {
        console.error('[BinauralDecoder] Failed to load HRTFs:', error);
        reject(error);
      }
    });
  }

  /**
   * Check if custom HRTFs are loaded
   */
  hasHRTFs(): boolean {
    return this.hrtfsLoaded;
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
    if (this.binDecoder) {
      try {
        this.binDecoder.out.disconnect();
      } catch (error) {
        console.warn('[BinauralDecoder] Error disconnecting binDecoder:', error);
      }
      this.binDecoder = null;
    }

    this.hrirLoader = null;
    this.inputNode = null;
    this.outputNode = null;
    this.audioContext = null;
    this.ready = false;
    this.hrtfsLoaded = false;
  }
}
