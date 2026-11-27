import { describe, expect, it } from 'vitest';
import { settingsForWaveOption, usedWaveValues, waveAdjustmentFrom } from './hybrid-wave-fit';
import type { HybridSettings } from '@/types/acoustics';

// The backend's report for a grid too large for the GPU (utils/hybrid_wave_fit.py)
const option = (key: 'conservative' | 'optimized', crossover: number, ppw: number) => ({
  key, label: `${key} label`, detail: 'detail', crossover_hz: crossover, ppw, precision: 'double',
  wave_fmax: crossover * 1.5, run_ppw: ppw, h: 0.0105, gpu_gb: 7.95, budget_gb: 8, runtime_s: 3166,
});
const partial = {
  progress_lanes: { lanes: [] },
  wave_adjustment: {
    reason: 'gpu',
    message: 'The wave grid at 1170 Hz ... needs 9.8 GB',
    requested: { crossover_hz: 1170, ppw: 20, precision: 'double' },
    options: [option('conservative', 1090, 20), option('optimized', 1170, 18)],
    recommended: 'conservative',
    applied: 'conservative',
  },
};
const settings = { crossover_mode: 'schroeder', crossover_hz: 200, ppw: 20, precision: 'double' } as HybridSettings;

describe('hybrid wave fit', () => {
  it('reads the fit from a job partial and ignores anything else', () => {
    const fit = waveAdjustmentFrom(partial);
    expect(fit?.applied).toBe('conservative');
    expect(fit?.options.map((o) => o.crossover_hz)).toEqual([1090, 1170]);
    expect(waveAdjustmentFrom({ progress_lanes: {} })).toBeNull();
    expect(waveAdjustmentFrom({ wave_adjustment: { reason: 'odd' } })).toBeNull();
    expect(waveAdjustmentFrom(null)).toBeNull();
  });

  it('marks only the values the run changed', () => {
    const fit = waveAdjustmentFrom(partial);
    const used = usedWaveValues(fit, 1170, settings);
    expect(used).toMatchObject({ crossoverHz: 1090, ppw: null, precision: null });
    // the card already set to what runs: nothing to mark
    expect(usedWaveValues(fit, 1090, settings)).toBeNull();
  });

  it('adopting an option makes its crossover a manual one', () => {
    const next = settingsForWaveOption(settings, waveAdjustmentFrom(partial)!.options[1]);
    expect(next).toMatchObject({ crossover_mode: 'manual', crossover_hz: 1170, ppw: 18, precision: 'double' });
  });
});
