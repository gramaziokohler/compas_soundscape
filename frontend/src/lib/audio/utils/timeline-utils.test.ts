import { describe, it, expect } from 'vitest';
import { parseAuthoredSeconds, generateLoopTimestamps } from './timeline-utils';

describe('parseAuthoredSeconds', () => {
  it('passes numeric seconds through unchanged', () => {
    // The old MM:SS-only parser turned 114.04 into 114*60 = 6842.4 (far clip bug).
    expect(parseAuthoredSeconds(114.04)).toBe(114.04);
    expect(parseAuthoredSeconds(42)).toBe(42);
    expect(parseAuthoredSeconds(0)).toBe(0);
  });

  it('parses MM:SS strings', () => {
    expect(parseAuthoredSeconds('00:36')).toBe(36);
    expect(parseAuthoredSeconds('01:30')).toBe(90);
    expect(parseAuthoredSeconds('02:05.5')).toBeCloseTo(125.5, 5);
  });

  it('falls back to Number for other strings', () => {
    expect(parseAuthoredSeconds('12.5')).toBe(12.5);
    expect(parseAuthoredSeconds('')).toBe(0);
    expect(parseAuthoredSeconds('nope')).toBe(0);
  });
});

describe('generateLoopTimestamps — background tiling', () => {
  it('tiles a clip back-to-back until the timeline is filled', () => {
    const ts = generateLoopTimestamps({
      soundId: 'bg',
      fallbackDurationSec: 10,
      intervalSec: 0,
      jitterSec: 0,
      timelineSec: 35,
    });
    expect(ts).toEqual([0, 10, 20, 30]);
  });

  it('advances by the per-iteration duration when provided', () => {
    const ts = generateLoopTimestamps({
      soundId: 'bg',
      durationSecPerIteration: [4],
      fallbackDurationSec: 10,
      intervalSec: 0,
      jitterSec: 0,
      timelineSec: 11,
    });
    expect(ts).toEqual([0, 4, 8]);
  });
});
