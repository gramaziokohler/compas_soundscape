/**
 * Type declarations for the Omnitone library
 * Google's spatial audio rendering library for First Order Ambisonics (FOA)
 * @see https://github.com/GoogleChrome/omnitone
 */

declare module 'omnitone' {
  /**
   * FOA Renderer for first-order ambisonic decoding
   * Converts 4-channel FOA streams to binaural stereo
   */
  export interface FOARenderer {
    /** Input GainNode accepting 4-channel FOA streams */
    input: GainNode;
    
    /** Output GainNode producing stereo output */
    output: GainNode;
    
    /** Initialize the renderer and load HRTF data */
    initialize(): Promise<void>;
    
    /** Set 3x3 rotation matrix (column-major) for ambisonic field rotation */
    setRotationMatrix3(matrix: number[]): void;
    
    /** Set 4x4 rotation matrix (column-major) for ambisonic field rotation */
    setRotationMatrix4(matrix: number[]): void;
    
    /** Set rendering mode: 'ambisonic' (spatial), 'bypass' (passthrough), or 'off' (disabled) */
    setRenderingMode(mode: 'ambisonic' | 'bypass' | 'off'): void;
  }

  /**
   * HOA Renderer for higher-order ambisonic decoding
   * Supports 2nd order (9ch) and 3rd order (16ch) ambisonics
   */
  export interface HOARenderer {
    /** Input GainNode accepting 9 or 16-channel HOA streams */
    input: GainNode;
    
    /** Output GainNode producing stereo output */
    output: GainNode;
    
    /** Initialize the renderer and load HRTF data */
    initialize(): Promise<void>;
    
    /** Set 3x3 rotation matrix (column-major) for ambisonic field rotation */
    setRotationMatrix3(matrix: number[]): void;
    
    /** Set 4x4 rotation matrix (column-major) for ambisonic field rotation */
    setRotationMatrix4(matrix: number[]): void;
    
    /** Set rendering mode */
    setRenderingMode(mode: 'ambisonic' | 'bypass' | 'off'): void;
  }

  /**
   * Configuration options for FOA/HOA renderers
   */
  export interface RendererConfig {
    /** Path to HRTF dataset (optional) */
    hrirPathList?: string[];
    
    /** Ambisonic order (only for HOARenderer, must be 2 or 3) */
    ambisonicOrder?: 2 | 3;
  }

  /**
   * Create a First Order Ambisonic (FOA) renderer
   * @param audioContext - Web Audio API context
   * @param config - Optional configuration
   * @returns FOARenderer instance
   */
  export function createFOARenderer(
    audioContext: AudioContext,
    config?: RendererConfig
  ): FOARenderer;

  /**
   * Create a Higher Order Ambisonic (HOA) renderer
   * @param audioContext - Web Audio API context
   * @param config - Optional configuration (must specify ambisonicOrder: 2 or 3)
   * @returns HOARenderer instance
   */
  export function createHOARenderer(
    audioContext: AudioContext,
    config?: RendererConfig
  ): HOARenderer;
}
