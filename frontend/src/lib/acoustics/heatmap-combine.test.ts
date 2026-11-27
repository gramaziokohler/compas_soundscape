import { describe, expect, it } from 'vitest';
import { combineHeatmap, heatmapSourceLevels, soundLevelAt1m } from './heatmap-combine';
import { HEATMAP_LISTENER_CONFIG } from '@/utils/constants';
import type { HeatmapPayload } from '@/types/heatmap';

const BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];
const flat = (db: number) => BANDS.map(() => db);

function payload(): HeatmapPayload {
  return {
    heatmap_id: 'h',
    bands: BANDS,
    inside: [true, true, false],
    points: [[0, 0, 0], [1, 0, 0], [9, 9, 9]],
    sources: [
      { id: 'a', position: [0, 0, 0], spl_bands: [flat(-10), flat(-20), null] },
      { id: 'b', position: [1, 0, 0], spl_bands: [flat(-10), flat(-10), null] },
    ],
    n_rays: 1000,
    warnings: [],
  };
}

describe('combineHeatmap', () => {
  it('one source: its map plus its level, per band', () => {
    const levels = combineHeatmap(payload(), { a: 80 }, 3);
    expect(levels[0]).toBeCloseTo(70, 6);
    expect(levels[1]).toBeCloseTo(60, 6);
  });

  it('two equal sources add 3 dB', () => {
    const levels = combineHeatmap(payload(), { a: 80, b: 80 }, 3);
    expect(levels[0]).toBeCloseTo(70 + 10 * Math.log10(2), 6);
  });

  it('silent sources are left out; no audible source gives null', () => {
    expect(combineHeatmap(payload(), { a: 80, b: null }, 3)[0]).toBeCloseTo(70, 6);
    expect(combineHeatmap(payload(), {}, 3)[0]).toBeNull();
  });

  it('points outside the room stay null', () => {
    expect(combineHeatmap(payload(), { a: 80, b: 80 }, 'spl_a')[2]).toBeNull();
  });

  it('dB(A) of a flat spectrum sums the A-weighted bands', () => {
    const weights = Object.values(HEATMAP_LISTENER_CONFIG.A_WEIGHTS);
    const expected = 10 * Math.log10(weights.reduce((sum, w) => sum + 10 ** ((70 + w) / 10), 0));
    expect(combineHeatmap(payload(), { a: 80 }, 'spl_a')[0]).toBeCloseTo(expected, 6);
  });
});

describe('heatmapSourceLevels', () => {
  const volumes: Record<string, number> = { s1: -18, s2: -18, s3: -6 };
  const volumeOf = (id: string) => volumes[id];

  it('sounds of one source add in energy', () => {
    const levels = heatmapSourceLevels({ a: ['s1', 's2'] }, volumeOf, new Set());
    expect(levels.a).toBeCloseTo(soundLevelAt1m(-18) + 10 * Math.log10(2), 6);
  });

  it('muted / not-soloed sounds are dropped; a fully silenced source is null', () => {
    const levels = heatmapSourceLevels({ a: ['s1', 's2'], b: ['s3'] }, volumeOf, new Set(['s2', 's3']));
    expect(levels.a).toBeCloseTo(soundLevelAt1m(-18), 6);
    expect(levels.b).toBeNull();
  });

  it('deleted sounds are ignored', () => {
    expect(heatmapSourceLevels({ a: ['gone'] }, volumeOf, new Set()).a).toBeNull();
  });
});
