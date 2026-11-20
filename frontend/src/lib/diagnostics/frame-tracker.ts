/**
 * Frame tracker — frame rate and worst main-thread frame gap from requestAnimationFrame.
 * Works in every browser (the long-task API is Chromium-only). Runs only while
 * started; a hidden tab pauses rAF, so the gap across a hide/show is ignored.
 */
import { PERFORMANCE_METER } from '@/utils/constants';

const ONE_SECOND_MS = 1000;

export class FrameTracker {
  private rafId: number | null = null;
  private last: number | null = null;
  /** Frame timestamps within the last second (fps). */
  private recent: number[] = [];
  /** Gaps ≥ STALL_MS within the stall window. */
  private gaps: Array<{ t: number; ms: number }> = [];

  private readonly onVisibility = () => {
    this.last = null;
  };

  start(): void {
    if (this.rafId !== null || typeof window === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibility);
    const tick = (now: number) => {
      if (this.last !== null) {
        const gap = now - this.last;
        if (gap >= PERFORMANCE_METER.STALL_MS) this.gaps.push({ t: now, ms: gap });
      }
      this.last = now;
      this.recent.push(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.last = null;
    this.recent = [];
    this.gaps = [];
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  get running(): boolean {
    return this.rafId !== null;
  }

  snapshot(now: number): { fps: number; worstGapMs: number } {
    this.recent = this.recent.filter((t) => now - t <= ONE_SECOND_MS);
    this.gaps = this.gaps.filter((g) => now - g.t <= PERFORMANCE_METER.STALL_WINDOW_MS);
    return {
      fps: this.recent.length,
      worstGapMs: this.gaps.reduce((worst, g) => Math.max(worst, g.ms), 0),
    };
  }
}
