/**
 * TypeScript declarations for the ambisonics library (JSAmbisonics)
 * https://github.com/polarch/JSAmbisonics
 */

declare module 'ambisonics' {
  export class monoEncoder {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    azim: number;
    elev: number;
    updateGains(): void;
  }

  export class convolver {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    updateFilters(audioBuffer: AudioBuffer): void;
  }

  export class binDecoder {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    updateFilters(audioBuffer: AudioBuffer): void;
    resetFilters(): void;
  }

  export class sceneRotator {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    yaw: number;
    pitch: number;
    roll: number;
    updateRotMtx(): void;
  }

  export class orderLimiter {
    constructor(audioContext: AudioContext, orderIn: number, orderOut: number);
    in: AudioNode;
    out: AudioNode;
  }

  export class orderWeight {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    updateWeights(weightsArray: number[]): void;
  }

  export class sceneMirror {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    mirror(axis: string): void;
  }

  export class virtualMic {
    constructor(audioContext: AudioContext, order: number);
    in: AudioNode;
    out: AudioNode;
    azim: number;
    elev: number;
    vmicPattern: number;
    updateOrientation(): void;
    updatePattern(pattern: number): void;
  }

  export namespace converters {
    function wxyz2acn(buffer: AudioBuffer): AudioBuffer;
    function acn2wxyz(buffer: AudioBuffer): AudioBuffer;
    function n3d2sn3d(buffer: AudioBuffer): AudioBuffer;
    function sn3d2n3d(buffer: AudioBuffer): AudioBuffer;
    function fuma2acn(buffer: AudioBuffer): AudioBuffer;
  }

  export class HRIRloader_local {
    constructor(audioContext: AudioContext, order: number, callback: () => void);
    load(hrirPath: string): void;
  }

  export class HRIRloader_ircam {
    constructor(audioContext: AudioContext, order: number, callback: () => void);
    load(hrirPath: string): void;
  }

  export class HOAloader {
    constructor(audioContext: AudioContext, order: number, url: string, callback: (audioBuffer: AudioBuffer) => void);
  }
}
