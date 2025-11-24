/**
 * JSAmbisonics Decoder Wrapper
 *
 * Wraps the JSAmbisonics library's binDecoder for binaural ambisonic decoding.
 * Uses HRTF-based convolution per ambisonic channel for proper spatial localization.
 *
 * Key differences from previous decoder:
 * - HRTF convolution per channel (not simple stereo panning)
 * - Encodes ITD (Interaural Time Difference) and ILD (Interaural Level Difference)
 * - Proper mid/side signal routing based on spherical harmonic order
 * - Result: Accurate left/right/front/back/up/down localization
 *
 * Based on: JSAmbisonics by Archontis Politis (Aalto University)
 * Reference: "JSAmbisonics: A Web Audio library for interactive spatial sound processing"
 */

import type { AmbisonicOrder } from "@/types/audio";

// JSAmbisonics type declarations (minimal, as library doesn't include TypeScript definitions)
interface AmbisonicsLibrary {
  binDecoder: new (audioContext: AudioContext, order: number) => {
    in: AudioNode;
    out: AudioNode;
    updateFilters(hrtfBuffer: AudioBuffer): void;
  };
}

/**
 * JSAmbisonics Binaural Decoder Wrapper
 *
 * Provides type-safe wrapper around JSAmbisonics binDecoder with:
 * - TypeScript interface matching our existing API
 * - Error handling and fallback behavior
 * - HRTF loading and management
 */
export class JSAmbisonicDecoder {
  private decoder: any;
  private audioContext: AudioContext;
  private order: 1 | 2 | 3;
  private hrtfsLoaded: boolean = false;

  constructor(audioContext: AudioContext, order: 1 | 2 | 3, ambisonicsLibrary?: any) {
    this.audioContext = audioContext;
    this.order = order;

    try {
      if (ambisonicsLibrary) {
        // Use provided library instance
        this.decoder = new ambisonicsLibrary.binDecoder(audioContext, order);
      } else {
        // Fallback to require (legacy behavior)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ambisonics = require("ambisonics") as AmbisonicsLibrary;
        this.decoder = new ambisonics.binDecoder(audioContext, order);
      }

      console.log(`[JSAmbisonics] Binaural decoder created (order ${order})`);
    } catch (error) {
      console.error("[JSAmbisonics] Failed to create decoder:", error);
      throw new Error(`Failed to initialize JSAmbisonics decoder: ${error}`);
    }
  }

  /**
   * Get input node (connect ambisonic sources here)
   */
  get input(): AudioNode {
    return this.decoder.in;
  }

  /**
   * Get output node (connects to destination or limiter)
   */
  get output(): AudioNode {
    return this.decoder.out;
  }

  /**
   * Load HRTF filters for improved spatial accuracy
   *
   * @param hrtfBuffer - Multi-channel AudioBuffer containing HRTF data
   *                     Format depends on ambisonic order:
   *                     - FOA (order 1): 4-channel HRTFs
   *                     - TOA (order 3): 16-channel HRTFs
   */
  async loadHRTFs(hrtfBuffer: AudioBuffer): Promise<void> {
    try {
      this.decoder.updateFilters(hrtfBuffer);
      this.hrtfsLoaded = true;
      console.log(`[JSAmbisonics] HRTFs loaded (${hrtfBuffer.numberOfChannels} channels)`);
    } catch (error) {
      console.error("[JSAmbisonics] Failed to load HRTFs:", error);
      console.warn("[JSAmbisonics] Falling back to default cardioid virtual microphones");
      // JSAmbisonics falls back to cardioid method automatically
    }
  }

  /**
   * Check if custom HRTFs are loaded
   */
  hasHRTFs(): boolean {
    return this.hrtfsLoaded;
  }

  /**
   * Get current ambisonic order
   */
  getOrder(): 1 | 2 | 3 {
    return this.order;
  }

  /**
   * Disconnect and clean up resources
   */
  disconnect(): void {
    try {
      if (this.decoder) {
        this.decoder.out.disconnect();
        // JSAmbisonics handles internal cleanup
      }
    } catch (error) {
      console.warn("[JSAmbisonics] Error during disconnect:", error);
    }
  }
}

/**
 * Factory function to create JSAmbisonics decoder nodes
 * Matches the API of the old createAmbisonicDecoderNodes() function
 *
 * @param audioContext - Web Audio API context
 * @param order - Ambisonic order (1 for FOA, 3 for TOA)
 * @returns Object with input and output nodes
 */
export function createJSAmbisonicDecoder(
  audioContext: AudioContext,
  order: 1 | 2 | 3
): { decoder: JSAmbisonicDecoder; input: AudioNode; output: AudioNode } {
  const decoder = new JSAmbisonicDecoder(audioContext, order);

  return {
    decoder,
    input: decoder.input,
    output: decoder.output,
  };
}
