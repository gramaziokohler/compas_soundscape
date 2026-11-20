import { describe, it, expect } from 'vitest';
import { PERFORMANCE_METER } from '@/utils/constants';
import type { PerformanceSample } from '@/types';
import { headroomLevel, levelFor, memoryThresholds, metricFills, metricLevels, worstLevel } from './performance-levels';

const T = PERFORMANCE_METER.THRESHOLDS;

function sample(partial: Partial<PerformanceSample> = {}): PerformanceSample {
  return {
    t: 0,
    heap: { usedMB: 500, totalMB: 600, limitMB: 4096 },
    audio: {
      irCacheCount: 0,
      irCacheBytes: 0,
      irCacheBudgetBytes: 0,
      irDecodes: 0,
      irRedecodes: 0,
      convolverBanks: 0,
      convolverNodes: 0,
      convolverFilterBytes: 0,
      irRunsInFlight: 0,
      irRunsPeak: 0,
      irSwaps: 0,
    },
    lights: null,
    gl: { programs: 190, geometries: 0, textures: 0, calls: 0, triangles: 0 },
    newPrograms: 0,
    recentIRSwaps: 0,
    deviceMemoryGB: 32,
    frames: { fps: 60, worstGapMs: 0 },
    longTasks: { count: 0, worstMs: 0 },
    xruns: 0,
    context: null,
    contextLost: false,
    playingVoices: 0,
    memoryMB: 500,
    support: { heap: true, longtask: true, xrun: true },
    ...partial,
  };
}

describe('levelFor', () => {
  it('bands a value against amber and red thresholds', () => {
    expect(levelFor(10, 50, 100)).toBe('ok');
    expect(levelFor(50, 50, 100)).toBe('warn');
    expect(levelFor(120, 50, 100)).toBe('crit');
    expect(levelFor(null, 50, 100)).toBe('na');
  });

  it('holds a level until the value clears the threshold by the hysteresis margin', () => {
    const justBelowCrit = 100 * (1 - PERFORMANCE_METER.HYSTERESIS / 2);
    expect(levelFor(justBelowCrit, 50, 100, 'crit')).toBe('crit');
    expect(levelFor(justBelowCrit, 50, 100, 'ok')).toBe('warn');
    expect(levelFor(80, 50, 100, 'crit')).toBe('warn');
  });

  it('supports metrics where lower is worse (frame rate)', () => {
    expect(levelFor(60, T.FPS.WARN, T.FPS.CRIT, 'ok', true)).toBe('ok');
    expect(levelFor(20, T.FPS.WARN, T.FPS.CRIT, 'ok', true)).toBe('warn');
    expect(levelFor(10, T.FPS.WARN, T.FPS.CRIT, 'ok', true)).toBe('crit');
  });
});

describe('metricLevels / metricFills', () => {
  it('is all OK for a calm sample', () => {
    const levels = metricLevels(sample());
    expect(levels).toEqual({ mem: 'ok', cpu: 'ok', dsp: 'ok', gpu: 'ok', xrun: 'ok' });
    expect(headroomLevel(levels)).toBe('ok');
  });

  it('flags the crash signature: recompile storm, long stall, overlapping IR loads', () => {
    const levels = metricLevels(
      sample({
        newPrograms: 9,
        longTasks: { count: 3, worstMs: 1236 },
        audio: { ...sample().audio!, irRunsPeak: 4, convolverNodes: 68 },
      }),
    );
    expect(levels.gpu).toBe('crit');
    expect(levels.cpu).toBe('crit');
    expect(levels.dsp).toBe('crit');
    expect(headroomLevel(levels)).toBe('crit');
  });

  it('latches GPU red on WebGL context loss', () => {
    const s = sample({ contextLost: true });
    expect(metricLevels(s).gpu).toBe('crit');
    expect(metricFills(s).gpu).toBe(1);
  });

  it('reports no data where the browser has no source', () => {
    const s = sample({ audio: null, gl: null, frames: null, support: { heap: false, longtask: false, xrun: false } });
    const levels = metricLevels(s);
    expect(levels.dsp).toBe('na');
    expect(levels.gpu).toBe('na');
    expect(levels.xrun).toBe('na');
    expect(metricFills(s).xrun).toBeNull();
  });

  it('fills relative to the red threshold, clamped to 1', () => {
    const { crit } = memoryThresholds(sample());
    expect(metricFills(sample({ memoryMB: crit / 2 })).mem).toBeCloseTo(0.5);
    expect(metricFills(sample({ memoryMB: crit * 3 })).mem).toBe(1);
  });
});

describe('worstLevel', () => {
  it('ranks na < ok < warn < crit', () => {
    expect(worstLevel('na', 'ok')).toBe('ok');
    expect(worstLevel('warn', 'ok')).toBe('warn');
    expect(worstLevel('warn', 'crit')).toBe('crit');
  });
});

describe('memoryThresholds', () => {
  const M = PERFORMANCE_METER.MEMORY;

  it('scales with the tab heap limit, not the machine RAM', () => {
    const big = memoryThresholds({ heap: { usedMB: 0, totalMB: 0, limitMB: 4096 }, deviceMemoryGB: 32 });
    expect(big.crit).toBeCloseTo(4096 * M.CRIT_FRACTION);
    expect(big.warn).toBeCloseTo(4096 * M.WARN_FRACTION);
  });

  it('caps red on a small machine', () => {
    const small = memoryThresholds({ heap: { usedMB: 0, totalMB: 0, limitMB: 4096 }, deviceMemoryGB: 4 });
    expect(small.crit).toBeCloseTo(4 * M.MB_PER_GB * M.DEVICE_CRIT_FRACTION);
    expect(small.warn).toBeLessThan(small.crit);
  });

  it('falls back to a default tab limit when the browser hides the heap', () => {
    expect(memoryThresholds({ heap: null, deviceMemoryGB: null }).crit).toBeCloseTo(M.DEFAULT_TAB_LIMIT_MB * M.CRIT_FRACTION);
  });
});
