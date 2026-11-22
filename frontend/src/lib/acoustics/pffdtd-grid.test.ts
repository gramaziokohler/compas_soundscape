import { describe, expect, it } from 'vitest';
import { gpuMaxMarker, pffdtdGridEstimate, pffdtdMaxGridProduct } from './pffdtd-grid';
import { hybridGpuLimits } from './hybrid';
import { HYBRID, PFFDTD } from '@/utils/constants';

const room: [number, number, number] = [20, 15, 8];
const GB = 1e9;

describe('pffdtdMaxGridProduct', () => {
  it('finds the largest fmax · PPW whose grid fits the memory', () => {
    const k = pffdtdMaxGridProduct(room, 'double', 8 * GB);
    const bytesAt = (product: number) => pffdtdGridEstimate(room, PFFDTD.SPEED_OF_SOUND / product, 'double', null).bytes;
    expect(bytesAt(k)).toBeLessThanOrEqual(8 * GB);
    expect(bytesAt(k * 1.01)).toBeGreaterThan(8 * GB);
  });

  it('single precision raises the limit by about the cube root of 2', () => {
    const ratio = pffdtdMaxGridProduct(room, 'single', 8 * GB) / pffdtdMaxGridProduct(room, 'double', 8 * GB);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.3);
  });

  it('is unlimited when the finest grid of the sliders fits, 0 when nothing does', () => {
    expect(pffdtdMaxGridProduct([0.1, 0.1, 0.1], 'single', 64 * GB)).toBe(Infinity);
    expect(pffdtdMaxGridProduct(room, 'double', 1)).toBe(0);
  });
});

describe('hybridGpuLimits', () => {
  it('links the crossover and the PPW through the wave band', () => {
    const limits = hybridGpuLimits(6000, 20, 300, 100);
    expect(limits.ppwMax).toBe(20); // 6000 / 300 Hz
    expect(limits.crossoverHzMax).toBeCloseTo(300 / HYBRID.WAVE_FMAX_MARGIN); // 6000 / 20 PPW = 300 Hz wave band
    expect(limits.factorMax).toBeCloseTo(2); // 200 Hz over a 100 Hz Schroeder frequency
  });

  it('has no crossover limit once the capped wave band fits', () => {
    expect(hybridGpuLimits(PFFDTD.FMAX_MAX * 10, 10, 300, null).crossoverHzMax).toBe(Infinity);
    expect(hybridGpuLimits(null, 10, 300, 100)).toEqual({ ppwMax: null, crossoverHzMax: null, factorMax: null });
  });
});

describe('gpuMaxMarker', () => {
  it('draws a tick inside the range, pins one below it, none above or unknown', () => {
    expect(gpuMaxMarker(30, 6, 80)).toEqual([{ value: 30, label: PFFDTD.GPU_MAX_MARKER_LABEL, tone: 'error' }]);
    expect(gpuMaxMarker(2, 6, 80)[0].value).toBe(6);
    expect(gpuMaxMarker(Infinity, 6, 80)).toEqual([]);
    expect(gpuMaxMarker(90, 6, 80)).toEqual([]);
    expect(gpuMaxMarker(null, 6, 80)).toEqual([]);
  });
});
