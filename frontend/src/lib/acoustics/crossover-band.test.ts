import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bandFrequency, bandGpuMaxHz, bandPosition, formatHz, hybridWaveGpuWarning, notePart, snapCrossover } from './crossover-band';
import { materialColumnsType, type SimulationConfig } from '@/types/acoustics';
import { FrequencyText } from '@/components/layout/sidebar/acoustics/FrequencyText';
import { hybridFormFields, defaultHybridSettings, restoreHybridSettings } from './hybrid';
import { HYBRID, HYBRID_BAND, PFFDTD } from '@/utils/constants';

describe('crossover band axis', () => {
  it('maps frequencies to a log axis and back', () => {
    expect(bandPosition(HYBRID_BAND.AXIS_MIN_HZ)).toBe(0);
    expect(bandPosition(HYBRID_BAND.AXIS_MAX_HZ)).toBe(1);
    expect(bandPosition(632.46)).toBeCloseTo(0.5, 3);           // geometric mean of 20 Hz and 20 kHz
    expect(bandFrequency(bandPosition(180))).toBeCloseTo(180, 6);
    expect(bandPosition(5)).toBe(0);
  });

  it('snaps near the recommended crossover, else clamps and rounds to the step', () => {
    expect(snapCrossover(181, 178.3)).toBe(178.3);
    expect(snapCrossover(250, 178.3)).toBe(250);
    expect(snapCrossover(10, null)).toBe(HYBRID.CROSSOVER_HZ_MIN);
    expect(snapCrossover(5000, null)).toBe(HYBRID.CROSSOVER_HZ_MAX);
    expect(snapCrossover(183, null) % HYBRID.CROSSOVER_HZ_STEP).toBe(0);
  });

  it('formats Hz and kHz', () => {
    expect(formatHz(180.4)).toBe('180 Hz');
    expect(formatHz(1250)).toBe('1.3 kHz');
  });
});

describe('bandGpuMaxHz', () => {
  it('divides by the wave margin only when both parts run', () => {
    const product = 6000;   // fmax · PPW that fits
    expect(bandGpuMaxHz(product, 12, 'wave')).toBeCloseTo(500);
    expect(bandGpuMaxHz(product, 12, 'both')).toBeCloseTo(500 / HYBRID.WAVE_FMAX_MARGIN);
    expect(bandGpuMaxHz(product, 12, 'rays')).toBeNull();
    expect(bandGpuMaxHz(null, 12, 'both')).toBeNull();
    expect(bandGpuMaxHz(PFFDTD.FMAX_MAX * 12, 12, 'both')).toBe(Infinity);
  });
});

describe('hybrid parts', () => {
  it('are sent with the run and survive a save', () => {
    expect(hybridFormFields(defaultHybridSettings(), 343).parts).toBe('both');
    expect(hybridFormFields({ ...defaultHybridSettings(), parts: 'rays' }, 343).parts).toBe('rays');
    expect(restoreHybridSettings({ parts: 'wave' }).parts).toBe('wave');
    expect(restoreHybridSettings({}).parts).toBeUndefined();
  });
});

describe('hybridWaveGpuWarning', () => {
  const room: [number, number, number] = [20, 15, 8];
  it('warns when the wave grid does not fit, never for rays alone', () => {
    const settings = { ...defaultHybridSettings(), crossover_mode: 'manual' as const, crossover_hz: 2000 };
    expect(hybridWaveGpuWarning(settings, null, room, 1e8)).toMatch(/GPU memory/);
    expect(hybridWaveGpuWarning({ ...settings, parts: 'rays' }, null, room, 1e8)).toBeNull();
    expect(hybridWaveGpuWarning(settings, null, room, null)).toBeNull();      // memory unknown
    expect(hybridWaveGpuWarning({ ...settings, crossover_hz: 40 }, null, room, 1e12)).toBeNull();
  });
});

describe('materialColumnsType', () => {
  it('drops the scattering column when the hybrid card runs the wave part alone', () => {
    const hybrid = (parts?: 'wave' | 'rays') => ({
      type: 'hybrid', settings: { ...defaultHybridSettings(), ...(parts ? { parts } : {}) },
    }) as unknown as SimulationConfig;
    expect(materialColumnsType(hybrid())).toBe('pyroomacoustics');
    expect(materialColumnsType(hybrid('rays'))).toBe('pyroomacoustics');
    expect(materialColumnsType(hybrid('wave'))).toBe('pffdtd');
    expect(materialColumnsType(null)).toBeNull();
  });
});

describe('FrequencyText', () => {
  it('puts the frequencies in bold', () => {
    const html = renderToStaticMarkup(createElement(FrequencyText, { text: 'Wave below 875 Hz, solved up to 1.3 kHz.' }));
    expect(html).toContain('<strong class="font-semibold text-foreground">875 Hz</strong>');
    expect(html).toContain('<strong class="font-semibold text-foreground">1.3 kHz</strong>');
    expect(html).toContain('Wave below ');
  });
});

describe('notePart', () => {
  it('colours a note with the part it is about', () => {
    expect(notePart('Wave grid refined from 12 to 31 points per wavelength at 139 Hz (11 cm cells).')).toBe('wave');
    expect(notePart('Edge diffraction skipped for 3 open edges.')).toBe('rays');
    expect(notePart('Crossover raised from 30 Hz to the 40 Hz minimum.')).toBeNull();
  });
});
