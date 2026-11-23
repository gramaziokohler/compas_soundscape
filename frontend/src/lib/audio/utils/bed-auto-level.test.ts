import { describe, expect, it } from 'vitest';
import { BACKGROUND_AUTO_LEVEL as C } from '@/utils/constants';
import {
  activeSeconds,
  bedAutoLevelDb,
  distanceBetween,
  distanceLossDb,
  eventsAverageLevelDb,
} from './bed-auto-level';

const GLOBAL = { isGlobal: true, distanceM: null };

describe('distanceLossDb', () => {
  it('is 1/r beyond the reference and uses the fallback when unknown', () => {
    expect(distanceLossDb(0.5)).toBe(0);
    expect(distanceLossDb(10)).toBeCloseTo(20);
    expect(distanceLossDb(null)).toBeCloseTo(20 * Math.log10(C.FALLBACK_LISTENER_DISTANCE_M));
  });
});

describe('activeSeconds', () => {
  it('sums explicit iterations clipped to the scene', () => {
    expect(activeSeconds(60, 2, [0, 10, 59], undefined, 0)).toBeCloseTo(5);
    expect(activeSeconds(60, 2, [0, 10], [4, 1], 0)).toBeCloseTo(5);
    expect(activeSeconds(60, 2, [70], undefined, 0)).toBe(0);
  });

  it('derives an auto loop from the interval gap', () => {
    expect(activeSeconds(60, 2, undefined, undefined, 8)).toBeCloseTo(12);
    expect(activeSeconds(60, 5, undefined, undefined, 0)).toBeCloseTo(60);
  });
});

describe('eventsAverageLevelDb', () => {
  it('weights each event by its share of the scene and its distance', () => {
    // One event at -24, 1 m away, playing the whole scene → -24.
    expect(eventsAverageLevelDb([{ levelDb: -24, distanceM: 1, activeSec: 60 }], 60)).toBeCloseTo(-24);
    // Playing 10 % of the time → -10 dB.
    expect(eventsAverageLevelDb([{ levelDb: -24, distanceM: 1, activeSec: 6 }], 60)).toBeCloseTo(-34);
    // Two identical events → +3 dB.
    const two = [{ levelDb: -24, distanceM: 1, activeSec: 60 }, { levelDb: -24, distanceM: 1, activeSec: 60 }];
    expect(eventsAverageLevelDb(two, 60)).toBeCloseTo(-24 + 10 * Math.log10(2));
    // 10 m away → -20 dB.
    expect(eventsAverageLevelDb([{ levelDb: -24, distanceM: 10, activeSec: 60 }], 60)).toBeCloseTo(-44);
  });

  it('is null when nothing plays', () => {
    expect(eventsAverageLevelDb([], 60)).toBeNull();
    expect(eventsAverageLevelDb([{ levelDb: -24, distanceM: 1, activeSec: 0 }], 60)).toBeNull();
  });
});

describe('bedAutoLevelDb', () => {
  it('sits MARGIN_DB under the events for a global bed', () => {
    // -24 at 1 m, half the time → -27 average → bed = -27 - margin.
    const events = [{ levelDb: -24, distanceM: 1, activeSec: 30 }];
    const avg = -24 + 10 * Math.log10(0.5);
    expect(bedAutoLevelDb(events, 60, GLOBAL)).toBeCloseTo(Math.max(C.MIN_DBFS, Math.min(C.MAX_DBFS, avg - C.MARGIN_DB)), 1);
  });

  it('gets louder for a busier scene and quieter for a sparse one', () => {
    const busy = Array.from({ length: 8 }, () => ({ levelDb: -24, distanceM: 4, activeSec: 30 }));
    const sparse = [{ levelDb: -24, distanceM: 4, activeSec: 3 }];
    expect(bedAutoLevelDb(busy, 60, GLOBAL)).toBeGreaterThan(bedAutoLevelDb(sparse, 60, GLOBAL));
  });

  it('stays inside the bed band', () => {
    expect(bedAutoLevelDb([{ levelDb: 0, distanceM: 1, activeSec: 60 }], 60, GLOBAL)).toBe(C.MAX_DBFS);
    expect(bedAutoLevelDb([{ levelDb: -60, distanceM: 20, activeSec: 1 }], 60, GLOBAL)).toBe(C.MIN_DBFS);
  });

  it('adds back the distance loss of a positioned bed', () => {
    // Global bed at -36 - margin; +6 dB for 2 m stays inside the band.
    const events = [{ levelDb: -36, distanceM: 1, activeSec: 60 }];
    const global = bedAutoLevelDb(events, 60, GLOBAL);
    const positioned = bedAutoLevelDb(events, 60, { isGlobal: false, distanceM: 2 });
    expect(positioned - global).toBeCloseTo(20 * Math.log10(2), 1);
  });

  it('falls back to the default without events', () => {
    expect(bedAutoLevelDb([], 60, GLOBAL)).toBe(C.DEFAULT_DBFS);
  });
});

describe('distanceBetween', () => {
  it('measures, or returns null when a point is missing', () => {
    expect(distanceBetween([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(distanceBetween(undefined, [3, 4, 0])).toBeNull();
  });
});
