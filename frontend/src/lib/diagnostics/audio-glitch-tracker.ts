/**
 * Audio dropout (xrun) counter.
 *
 * Uses the browser's own underrun count when it reports one (AudioContext.playbackStats,
 * feature-detected). Otherwise compares how far the audio clock and the wall clock moved
 * between two getOutputTimestamp() readings: while the context runs they advance together,
 * so a jump larger than XRUN_DRIFT_MS means the output stalled.
 */
import { PERFORMANCE_METER } from '@/utils/constants';
import type { AudioContextHealth } from '@/types';

export class AudioGlitchTracker {
  private prev: AudioContextHealth | null = null;
  private events: number[] = [];

  /** Whether this context can report dropouts at all. */
  static supported(health: AudioContextHealth | null): boolean {
    return !!health && (health.underruns !== null || health.performanceTime > 0);
  }

  /** Feed one snapshot; returns the dropouts within the xrun window. */
  update(health: AudioContextHealth | null, now: number): number {
    const prev = this.prev;
    this.prev = health;
    if (health && prev && health.state === 'running' && prev.state === 'running') {
      if (health.underruns !== null && prev.underruns !== null) {
        const added = health.underruns - prev.underruns;
        for (let i = 0; i < added; i++) this.events.push(now);
      } else if (health.performanceTime > 0 && prev.performanceTime > 0) {
        const wallMs = health.performanceTime - prev.performanceTime;
        const audioMs = (health.contextTime - prev.contextTime) * 1000;
        if (wallMs > 0 && Math.abs(wallMs - audioMs) > PERFORMANCE_METER.XRUN_DRIFT_MS) this.events.push(now);
      }
    }
    this.events = this.events.filter((t) => now - t <= PERFORMANCE_METER.XRUN_WINDOW_MS);
    return this.events.length;
  }
}
