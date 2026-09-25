import { describe, it, expect } from 'vitest';
import { serializeTrackOverlaps } from './serialize-track-overlaps';

describe('serializeTrackOverlaps', () => {
  it('leaves non-overlapping iterations untouched', () => {
    const r = serializeTrackOverlaps([0, 5, 12], [3, 4, 2], [false, true, false]);
    expect(r.starts).toEqual([0, 5, 12]);
    expect(r.paramNudges).toBe(0);
  });

  it('pushes an overlapping later iteration to the previous end (non-param)', () => {
    const r = serializeTrackOverlaps([10, 11], [5, 2], [false, false]);
    expect(r.starts).toEqual([10, 15]);
    expect(r.paramNudges).toBe(0);
  });

  it('serializes parametric self-overlap and reports the nudge', () => {
    // Two speech lines both anchored to the same reference start.
    const r = serializeTrackOverlaps([3, 3.2], [10, 8], [true, true]);
    expect(r.starts).toEqual([3, 13]);
    expect(r.paramNudges).toBe(1);
  });

  it('serializes a chain of three colliding iterations', () => {
    const r = serializeTrackOverlaps([0, 0.5, 1], [4, 4, 4], [false, true, true]);
    expect(r.starts).toEqual([0, 4, 8]);
    expect(r.paramNudges).toBe(2);
  });

  it('leaves null (excluded/unresolved) slots untouched', () => {
    const r = serializeTrackOverlaps([null, 2, 3], [5, 5, 1], [true, true, false]);
    // slot 0 stays null; slot 2 is pushed past slot 1's end
    expect(r.starts[0]).toBeNull();
    expect(r.starts[2]).toBe(7);
  });

  it('ignores zero/unknown durations', () => {
    const r = serializeTrackOverlaps([5, 5], [0, 0], [true, true]);
    expect(r.starts).toEqual([5, 5]);
    expect(r.paramNudges).toBe(0);
  });
});
