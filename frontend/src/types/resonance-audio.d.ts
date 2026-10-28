/**
 * Type declarations for resonance-audio library
 * Based on: https://resonance-audio.github.io/resonance-audio/reference/web/ResonanceAudio.html
 */

declare module 'resonance-audio' {
  /**
   * Main Resonance Audio scene interface
   */
  export default class ResonanceAudio {
    /**
     * Create a new Resonance Audio scene
     * @param audioContext - Web Audio API context
     * @param options - Configuration options
     */
    constructor(audioContext: AudioContext, options?: {
      ambisonicOrder?: number;
      listenerPosition?: [number, number, number];
      speedOfSound?: number;
      dimensions?: {
        width: number;
        height: number;
        depth: number;
      };
      materials?: {
        left: string;
        right: string;
        front: string;
        back: string;
        down: string;
        up: string;
      };
    });

    /**
     * Output audio node (connect to destination) - binaural stereo
     */
    output: GainNode;

    /**
     * Ambisonic (multichannel) output audio node for external processing.
     * Carries FOA (4ch), SOA (9ch), or TOA (16ch) depending on ambisonicOrder.
     */
    ambisonicOutput: GainNode;

    /**
     * Create a new audio source
     */
    createSource(): ResonanceAudioSource;

    /**
     * Set room properties (dimensions and materials)
     */
    setRoomProperties(
      dimensions: { width: number; height: number; depth: number },
      materials: { left: string; right: string; front: string; back: string; down: string; up: string }
    ): void;

    /**
     * Set listener position
     */
    setListenerPosition(x: number, y: number, z: number): void;

    /**
     * Set listener orientation
     */
    setListenerOrientation(
      forwardX: number, forwardY: number, forwardZ: number,
      upX: number, upY: number, upZ: number
    ): void;

    /**
     * Private listener (ambisonic mix input). Used to isolate a source's dry
     * encoder path so overlapping rooms can share one direct sound.
     */
    _listener: { input: AudioNode };
  }

  /**
   * Resonance Audio source interface
   */
  export interface ResonanceAudioSource {
    /**
     * Input audio node (connect audio source here)
     */
    input: AudioNode;

    /**
     * Set source position in 3D space
     */
    setPosition(x: number, y: number, z: number): void;

    /**
     * Set source gain
     */
    setGain(gain: number): void;

    /**
     * Set distance attenuation model
     */
    setDistanceModel(
      rolloff: 'logarithmic' | 'linear' | 'none',
      minDistance: number,
      maxDistance: number
    ): void;

    /**
     * Set directivity pattern
     */
    setDirectivityPattern(
      pattern: number,
      sharpness: number
    ): void;

    /**
     * Set source orientation
     */
    setOrientation(
      forwardX: number, forwardY: number, forwardZ: number,
      upX: number, upY: number, upZ: number
    ): void;

    /**
     * Private ambisonic encoder. `_encoder.output` is the dry path into the
     * listener; ResonanceMode re-routes it through a GainNode for overlap blend.
     */
    _encoder: { output: AudioNode };

    setRolloff?(rolloff: string): void;
    setMinDistance?(distance: number): void;
    setMaxDistance?(distance: number): void;
    setSourceWidth?(degrees: number): void;
  }
}
