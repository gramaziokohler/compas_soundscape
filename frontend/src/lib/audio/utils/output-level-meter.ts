/**
 * OutputLevelMeter
 *
 * Measures what the user actually hears: an `AnalyserNode` inserted inline
 * between the master limiter and `audioContext.destination` (transparent
 * pass-through). `sample()` returns an exponentially averaged RMS level in
 * dBFS, so gaps between clips and short transients do not flip the result.
 *
 * Usage:
 * ```ts
 * const meter = new OutputLevelMeter(ctx);
 * limiter.connect(meter.node);
 * meter.node.connect(ctx.destination);
 * const dbfs = meter.sample(); // call at a steady poll rate
 * ```
 */

import { LOW_OUTPUT_HINT } from '@/utils/constants';
import { linearToDbfs } from '@/utils/utils';

export class OutputLevelMeter {
  readonly node: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;
  private averagedPower = 0;
  private seeded = false;

  constructor(audioContext: AudioContext) {
    this.node = audioContext.createAnalyser();
    this.node.fftSize = LOW_OUTPUT_HINT.FFT_SIZE;
    this.node.smoothingTimeConstant = 0;
    this.buffer = new Float32Array(this.node.fftSize) as Float32Array<ArrayBuffer>;
  }

  /**
   * Read the current window and fold it into the running average.
   * Assumes it is called every `LOW_OUTPUT_HINT.POLL_MS`.
   * @returns Averaged output level in dBFS (-Infinity for digital silence).
   */
  sample(): number {
    this.node.getFloatTimeDomainData(this.buffer);

    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const v = this.buffer[i];
      sum += v * v;
    }
    const power = sum / this.buffer.length;

    // The first window after a reset seeds the average instead of ramping from 0.
    const alpha = this.seeded ? Math.min(1, LOW_OUTPUT_HINT.POLL_MS / LOW_OUTPUT_HINT.AVERAGE_WINDOW_MS) : 1;
    this.seeded = true;
    this.averagedPower += (power - this.averagedPower) * alpha;
    return linearToDbfs(Math.sqrt(this.averagedPower));
  }

  /** Forget the running average (e.g. when playback restarts). */
  reset(): void {
    this.averagedPower = 0;
    this.seeded = false;
  }

  dispose(): void {
    try {
      this.node.disconnect();
    } catch {
      // Already disconnected
    }
  }
}
