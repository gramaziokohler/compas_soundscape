import { describe, it, expect } from 'vitest';
import { computeTimelineOverrun, type OverrunTrack } from './daw-overrun';
import { AUDIO_TIMELINE } from '@/utils/constants';

const track = (partial: Partial<OverrunTrack>): OverrunTrack => ({
  startsSec: [],
  fallbackDurationMs: 5_000,
  ...partial,
});

describe('computeTimelineOverrun', () => {
  it('returns null when every clip fits', () => {
    expect(computeTimelineOverrun([track({ startsSec: [0, 10, 25] })], 30_000)).toBeNull();
  });

  it('flags a clip that starts inside but ends past the end', () => {
    const r = computeTimelineOverrun([track({ startsSec: [0, 27] })], 30_000);
    expect(r).toEqual({ iterationCount: 1, contentEndMs: 32_000, proposedDurationMs: 32_000 });
  });

  it('flags clips that start past the end', () => {
    const r = computeTimelineOverrun([track({ startsSec: [10, 40.2] })], 30_000);
    expect(r?.iterationCount).toBe(1);
    expect(r?.proposedDurationMs).toBe(46_000);
  });

  it('uses per-iteration durations from the bake', () => {
    const r = computeTimelineOverrun(
      [track({ startsSec: [0, 20], iterationDurationsMs: [0, 12_500] })],
      30_000,
    );
    expect(r?.contentEndMs).toBe(32_500);
    expect(r?.proposedDurationMs).toBe(33_000);
  });

  it('ignores unresolved sentinels and excluded iterations', () => {
    const r = computeTimelineOverrun(
      [track({ startsSec: [0, AUDIO_TIMELINE.UNRESOLVED_TIMESTAMP_SEC, 50], excludedIndices: [2] })],
      30_000,
    );
    expect(r).toBeNull();
  });

  it('ignores auto and background tracks', () => {
    const r = computeTimelineOverrun(
      [track({ startsSec: undefined }), track({ startsSec: [28], isBackground: true })],
      30_000,
    );
    expect(r).toBeNull();
  });

  it('tolerates float slack at the end', () => {
    expect(computeTimelineOverrun([track({ startsSec: [25.00001] })], 30_000)).toBeNull();
  });
});
