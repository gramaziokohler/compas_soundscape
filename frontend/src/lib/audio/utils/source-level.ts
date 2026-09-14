/**
 * SourceLevelMeter
 *
 * Per-source realtime level probe used to drive audio-reactive visuals
 * (sound-sphere highlight + dark-mode point-light intensity).
 *
 * It wraps a single `AnalyserNode` that is inserted INLINE into a source's
 * persistent gain chain. `AnalyserNode` is a transparent pass-through, so
 * inserting it does not alter the signal. Reading RMS from the analyser yields
 * the post-fader signal level, which already folds in the source volume — the
 * visual layer only needs to multiply by its own brightness range.
 *
 * Reading is cheap (a 256-sample time-domain copy) and smoothed with a fast
 * attack / slow release so a light does not flicker on every sampled frame.
 */

import { AUDIO_LEVEL } from '@/utils/constants';

export class SourceLevelMeter {
  readonly node: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;
  private smoothed = 0;

  constructor(audioContext: AudioContext) {
    this.node = audioContext.createAnalyser();
    this.node.fftSize = AUDIO_LEVEL.FFT_SIZE;
    this.node.smoothingTimeConstant = 0;
    this.buffer = new Float32Array(this.node.fftSize) as Float32Array<ArrayBuffer>;
  }

  /**
   * Read the current smoothed level.
   * @returns 0..1 where 0 is silence and 1 is a loud passage.
   */
  read(): number {
    this.node.getFloatTimeDomainData(this.buffer);

    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const v = this.buffer[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buffer.length);

    // Typical speech/music RMS is ~0.01..0.4; scale into a usable 0..1 range.
    let target = rms * AUDIO_LEVEL.RMS_SCALE;
    if (target < AUDIO_LEVEL.SILENCE_THRESHOLD) target = 0;
    if (target > 1) target = 1;

    const alpha = target > this.smoothed ? AUDIO_LEVEL.ATTACK : AUDIO_LEVEL.RELEASE;
    this.smoothed += (target - this.smoothed) * alpha;
    return this.smoothed;
  }

  dispose(): void {
    try {
      this.node.disconnect();
    } catch {
      // Already disconnected
    }
  }
}
