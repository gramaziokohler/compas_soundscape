/**
 * TypeScript declarations for the ambisonics library (JSAmbisonics)
 * https://github.com/polarch/JSAmbisonics
 *
 * Only monoEncoder and convolver are retained — all decoding is handled by OmnitoneDecoder.
 */

declare module 'ambisonics' {
  export class monoEncoder {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    azim: number;
    elev: number;
    updateGains(): void;
    gainNodes: GainNode[]; // accessed by SoundscapeExporter for SN3D normalization
  }

  export class convolver {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    updateFilters(audioBuffer: AudioBuffer): void;
  }
}
