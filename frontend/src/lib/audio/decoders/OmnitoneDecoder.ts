/**
 * OmnitoneDecoder
 *
 * Unified Omnitone-based binaural decoder for all ambisonic orders.
 * - Order 1 (FOA):  Omnitone.createFOARenderer  → 4-ch input, stereo out
 * - Order 2 (SOA):  Omnitone.createHOARenderer(2) → 9-ch input, stereo out
 * - Order 3 (TOA):  Omnitone.createHOARenderer(3) → 16-ch input, stereo out
 *
 * All renderers use SN3D (AmbiX) natively — no normalization conversion needed.
 * Rotation is applied via renderer.setRotationMatrix3() for both FOARenderer
 * and HOARenderer (same 3×3 matrix interface).
 *
 * Signal chain: Input Gain → [Internal Rotator + HRIR Convolver] → Output Gain
 */

import type { IBinauralDecoder } from '../core/interfaces/IBinauralDecoder';
import type { Orientation } from '@/types/audio';
import type { FOARenderer, HOARenderer } from 'omnitone';
import { IDENTITY_MATRIX3, orientationToRotationMatrix3 } from '../utils/ambisonic-utils';

type AnyRenderer = FOARenderer | HOARenderer;

export class OmnitoneDecoder implements IBinauralDecoder {
  private audioContext: AudioContext | null = null;
  private renderer: AnyRenderer | null = null;
  private order: 1 | 2 | 3 = 1;
  private ready: boolean = false;
  private rotationEnabled: boolean = false;
  private currentOrientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

  async initialize(audioContext: AudioContext, order: 1 | 2 | 3 = 1): Promise<void> {
    this.audioContext = audioContext;
    this.order = order;
    this.ready = false;

    try {
      console.log(`[OmnitoneDecoder] Initializing for order ${order}`);
      const OmnitoneModule = await import('omnitone/build/omnitone.esm.js');
      const Omnitone = OmnitoneModule.default;

      let renderer: AnyRenderer;
      if (order === 1) {
        renderer = Omnitone.createFOARenderer(audioContext);
      } else {
        renderer = Omnitone.createHOARenderer(audioContext, { ambisonicOrder: order });
      }

      this.renderer = renderer;
      await renderer.initialize();

      // Discard if superseded during async init
      if (this.renderer !== renderer) {
        renderer.setRenderingMode('off');
        return;
      }

      renderer.setRenderingMode('ambisonic');
      this.ready = true;
      console.log(`[OmnitoneDecoder] Initialized (order ${order}, SN3D native)`);
    } catch (error) {
      console.error('[OmnitoneDecoder] Initialization failed:', error);
      throw error;
    }
  }

  async setOrder(order: 1 | 2 | 3): Promise<void> {
    if (order === this.order && this.ready) return;
    this.dispose();
    if (this.audioContext) {
      await this.initialize(this.audioContext, order);
    }
  }

  getInputNode(): AudioNode {
    if (!this.renderer) throw new Error('[OmnitoneDecoder] Not initialized');
    return this.renderer.input;
  }

  getOutputNode(): AudioNode {
    if (!this.renderer) throw new Error('[OmnitoneDecoder] Not initialized');
    return this.renderer.output;
  }

  setRotationEnabled(enabled: boolean): void {
    this.rotationEnabled = enabled;
    if (!enabled && this.renderer) {
      this.renderer.setRotationMatrix3([...IDENTITY_MATRIX3]);
    }
  }

  /**
   * Evaluate listener orientation via Omnitone's setRotationMatrix3.
   * Matrix is Ry(yaw) * Rx(pitch) * Rz(roll), column-major, Y-up convention.
   * Works identically for FOARenderer and HOARenderer.
   * With roll = 0 this reduces to the previous Ry * Rx matrix.
   */
  updateOrientation(orientation: Orientation): void {
    if (!this.renderer) return;
    this.currentOrientation = orientation;

    this.renderer.setRotationMatrix3(
      this.rotationEnabled ? orientationToRotationMatrix3(orientation) : [...IDENTITY_MATRIX3]
    );
  }

  isReady(): boolean {
    return this.ready && this.renderer !== null;
  }

  getOrder(): 1 | 2 | 3 {
    return this.order;
  }

  dispose(): void {
    if (this.renderer) {
      try {
        this.renderer.setRenderingMode('off');
        this.renderer.input?.disconnect();
        this.renderer.output?.disconnect();
      } catch (error) {
        console.warn('[OmnitoneDecoder] Error during dispose:', error);
      }
      this.renderer = null;
    }
    this.audioContext = null;
    this.ready = false;
  }
}
