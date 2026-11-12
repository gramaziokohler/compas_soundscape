import { describe, expect, it } from 'vitest';
import {
  cumulativeDistances,
  firstArrivals,
  pathCounts,
  pickScreenEdge,
  pointAtDistance,
  pointSegmentDistance2D,
  reflectionsPassed,
  visibleDiffracted,
  visibleEdges,
  visibleRays,
  visibleReflections,
} from './acoustic-paths';
import {
  ambisonicOrder,
  channelCount,
  effectiveEngineSettings,
  engineFormFields,
  engineSummaryRows,
  pickGeometricEngineSettings,
  resolveEngine,
  sameEdge,
  temperatureForSoundSpeed,
  toggleExcludedEdge,
  usesCompasAcoustics,
  type EngineCapabilities,
} from './geometric-engine';
import {
  crossoverReadout,
  defaultHybridSettings,
  hybridFormFields,
  hybridRunSummary,
  mismatchWarning,
  planCrossover,
  restoreHybridSettings,
  schroederFrequency,
} from './hybrid';
import { HYBRID } from '@/utils/constants';
import type { AcousticPathsPayload, AcousticPathsView } from '@/types/acousticPaths';
import type { HybridRunInfo } from '@/types/acoustics';

const VIEW: AcousticPathsView = {
  showReflections: true, showDiffraction: true, showEdges: true, showRays: true,
  maxOrder: 3, timeWindowMs: null, sourceId: null, receiverId: null, obstacleEdgesOnly: false,
};

const payload = (): AcousticPathsPayload => ({
  paths_id: 'p', speed_of_sound: 343, notes: [],
  sources: [{ id: 's1', position: [0, 0, 0] }, { id: 's2', position: [5, 0, 0] }],
  receivers: [{ id: 'r1', position: [2, 0, 0] }],
  reflections: {
    max_order: 2, truncated: false,
    paths: [
      { s: 0, r: 0, order: 0, points: [0, 0, 0, 2, 0, 0], distance: 2, delay_ms: 5.8, level_db: -6 },
      { s: 0, r: 0, order: 1, points: [0, 0, 0, 1, 1, 0, 2, 0, 0], distance: 2.8, delay_ms: 8.2, level_db: -10 },
      { s: 0, r: 0, order: 2, points: [0, 0, 0, 1, 9, 0, 1, -9, 0, 2, 0, 0], distance: 36, delay_ms: 105, level_db: -32 },
      { s: 1, r: 0, order: 0, points: [5, 0, 0, 2, 0, 0], distance: 3, delay_ms: 8.7, level_db: -9.5 },
    ],
  },
  rays: { n_rays: 2, max_order: 2, duration_ms: 20, rays: [{ s: 0, points: [0, 0, 0, 3, 0, 0, 3, 4, 0] }, { s: 1, points: [5, 0, 0, 5, 2, 0] }] },
  diffraction: {
    edges: [
      { id: 0, segment: [1, 0, 0, 1, 0, 2], length: 2, wedge_deg: 0, kind: 'obstacle', excluded: false, used: true },
      { id: 1, segment: [0, 5, 0, 6, 5, 0], length: 6, wedge_deg: 90, kind: 'boundary', excluded: true, used: false },
    ],
    paths: [{ s: 0, r: 0, edge: 0, zone: 'shadow', order: 0, points: [0, 0, 0, 1, 0, 2, 2, 0, 0], distance: 4.5, delay_ms: 13, level_db: -20 }],
  },
});

describe('sound-path view filters', () => {
  it('filters reflections by order, pair and arrival window', () => {
    expect(visibleReflections(payload(), VIEW)).toHaveLength(4);
    expect(visibleReflections(payload(), { ...VIEW, maxOrder: 1 }).map((p) => p.order)).toEqual([0, 1, 0]);
    expect(visibleReflections(payload(), { ...VIEW, sourceId: 's2' })).toHaveLength(1);
    // 50 ms after each pair's first arrival: the 105 ms second-order path of s1 drops out
    expect(visibleReflections(payload(), { ...VIEW, timeWindowMs: 50 })).toHaveLength(3);
    expect(visibleReflections(payload(), { ...VIEW, showReflections: false })).toEqual([]);
  });

  it('references the window to the first arrival of each pair', () => {
    const first = firstArrivals(payload().reflections!.paths);
    expect(first.get('0:0')).toBe(5.8);
    expect(first.get('1:0')).toBe(8.7);
  });

  it('filters diffracted paths, edges and rays', () => {
    expect(visibleDiffracted(payload(), VIEW)).toHaveLength(1);
    expect(visibleDiffracted(payload(), { ...VIEW, timeWindowMs: 5 })).toHaveLength(0);
    expect(visibleDiffracted(payload(), { ...VIEW, sourceId: 's2' })).toHaveLength(0);
    expect(visibleEdges(payload(), VIEW)).toHaveLength(2);
    expect(visibleEdges(payload(), { ...VIEW, obstacleEdgesOnly: true }).map((e) => e.id)).toEqual([0]);
    expect(visibleEdges(payload(), { ...VIEW, showEdges: false })).toEqual([]);
    expect(visibleRays(payload(), { ...VIEW, sourceId: 's1' })).toHaveLength(1);
    // a listener filter does not hide rays: they belong to a source only
    expect(visibleRays(payload(), { ...VIEW, receiverId: 'r1' })).toHaveLength(2);
  });

  it('counts what a payload holds', () => {
    expect(pathCounts(payload())).toEqual({ reflections: 4, diffracted: 1, edges: 2, excluded: 1, used: 1, rays: 2 });
    expect(pathCounts(null).edges).toBe(0);
  });
});

describe('billiard particle positions', () => {
  const points = [0, 0, 0, 3, 0, 0, 3, 4, 0];
  const cumulative = cumulativeDistances(points);

  it('accumulates distance along the ray', () => {
    expect(Array.from(cumulative)).toEqual([0, 3, 7]);
  });

  it('interpolates within a segment and reports it', () => {
    expect(pointAtDistance(points, cumulative, 1.5)).toEqual([1.5, 0, 0, 0]);
    expect(pointAtDistance(points, cumulative, 5)).toEqual([3, 2, 0, 1]);
    expect(pointAtDistance(points, cumulative, 0)).toEqual([0, 0, 0, 0]);
    expect(pointAtDistance(points, cumulative, 7)).toEqual([3, 4, 0, 1]);
  });

  it('has no particle before the start or after the end', () => {
    expect(pointAtDistance(points, cumulative, -0.1)).toBeNull();
    expect(pointAtDistance(points, cumulative, 7.01)).toBeNull();
    expect(pointAtDistance([0, 0, 0], cumulativeDistances([0, 0, 0]), 0)).toBeNull();
  });

  it('counts the reflections passed', () => {
    expect(reflectionsPassed(cumulative, 2)).toBe(0);
    expect(reflectionsPassed(cumulative, 3)).toBe(0); // on the wall: reflected once it moves on
    expect(reflectionsPassed(cumulative, 3.1)).toBe(1);
    expect(reflectionsPassed(cumulative, 7)).toBe(1); // the end of a ray is no reflection
  });
});

describe('edge picking', () => {
  it('measures the distance to a segment, not its line', () => {
    expect(pointSegmentDistance2D(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(pointSegmentDistance2D(13, 4, 0, 0, 10, 0)).toBe(5);
    expect(pointSegmentDistance2D(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
  });

  it('picks the nearest edge within the tolerance, the front one on a tie', () => {
    const edges = [
      { id: 1, ax: 0, ay: 0, bx: 100, by: 0, depth: 0.9 },
      { id: 2, ax: 0, ay: 20, bx: 100, by: 20, depth: 0.5 },
      { id: 3, ax: 0, ay: 0.5, bx: 100, by: 0.5, depth: 0.2 },
    ];
    expect(pickScreenEdge(edges, 50, 18, 8)).toBe(2);
    expect(pickScreenEdge(edges, 50, 10, 8)).toBeNull();
    expect(pickScreenEdge(edges, 50, 0, 8)).toBe(3); // 1 and 3 overlap on screen: 3 is nearer the camera
    expect(pickScreenEdge([], 0, 0, 8)).toBeNull();
  });
});

const CAPS: EngineCapabilities = {
  default: 'compas_acoustics',
  engines: {
    compas_acoustics: { available: true, modes: ['mono', 'foa', 'hoa'], diffraction: ['off', 'udfa', 'btms'], tails: [], max_ambisonic_order: 3, paths: ['reflections'] },
    pyroomacoustics: { available: true, modes: ['mono', 'foa'], diffraction: ['off'], tails: [], max_ambisonic_order: 1, paths: [] },
  },
};
const LEGACY_ONLY: EngineCapabilities = {
  default: 'pyroomacoustics',
  engines: { ...CAPS.engines, compas_acoustics: { ...CAPS.engines.compas_acoustics, available: false } },
};

describe('geometric engine settings', () => {
  it('resolves the engine a card runs on', () => {
    expect(resolveEngine({}, CAPS)).toBe('compas_acoustics');
    expect(resolveEngine({ engine: 'auto' }, LEGACY_ONLY)).toBe('pyroomacoustics');
    expect(resolveEngine({ engine: 'pyroomacoustics' }, CAPS)).toBe('pyroomacoustics');
    expect(usesCompasAcoustics({}, CAPS)).toBe(true);
    expect(usesCompasAcoustics({ engine: 'compas_acoustics' }, LEGACY_ONLY)).toBe(false); // not installed
    expect(usesCompasAcoustics({}, null)).toBe(true); // unknown backend: the run decides
  });

  it('gives the channel count of each mode', () => {
    expect(channelCount('mono', {})).toBe(1);
    expect(channelCount('foa', { ambisonic_order: 3 })).toBe(4);
    expect(channelCount('hoa', {})).toBe(9);
    expect(channelCount('hoa', { ambisonic_order: 3 })).toBe(16);
    expect(ambisonicOrder('hoa', { ambisonic_order: 7 })).toBe(3);
    expect(ambisonicOrder('hoa', { ambisonic_order: 1 })).toBe(2);
  });

  it('adjusts what the engine cannot run and says so', () => {
    const legacy = effectiveEngineSettings({ simulation_mode: 'hoa', diffraction: 'udfa', engine: 'pyroomacoustics' }, CAPS);
    expect(legacy.settings.simulation_mode).toBe('foa');
    expect(legacy.settings.diffraction).toBe('off');
    expect(legacy.changes).toHaveLength(2);
    const btmsMono = effectiveEngineSettings({ simulation_mode: 'mono', diffraction: 'btms' }, CAPS);
    expect(btmsMono.settings.diffraction).toBe('udfa');
    expect(effectiveEngineSettings({ simulation_mode: 'foa', diffraction: 'btms' }, CAPS).changes).toEqual([]);
  });

  it('sends only what is set', () => {
    expect(engineFormFields({ simulation_mode: 'mono' })).toEqual({});
    expect(engineFormFields({
      simulation_mode: 'hoa', engine: 'auto', diffraction: 'udfa', ambisonic_order: 3, tail: 'eyring', n_slopes: 2,
      seed: 7, scattering_split: true, air_temperature: 18.5, air_humidity: 40, excluded_edges: [[0, 0, 0, 1, 0, 0]],
    })).toEqual({
      diffraction: 'udfa', ambisonic_order: '3', tail: 'eyring', n_slopes: '2', seed: '7', scattering_split: 'true',
      air_temperature: '18.5', air_humidity: '40', excluded_edges: '[[0,0,0,1,0,0]]',
    });
    // an order is only sent for HOA; a null temperature means "from the sound speed"
    expect(engineFormFields({ simulation_mode: 'foa', ambisonic_order: 3, air_temperature: null })).toEqual({});
  });

  it('keeps only the engine fields when saving', () => {
    const picked = pickGeometricEngineSettings({ diffraction: 'udfa', air_temperature: null, max_order: 3 } as never);
    expect(picked).toEqual({ diffraction: 'udfa' });
    expect(pickGeometricEngineSettings(undefined)).toEqual({});
  });

  it('converts the sound speed like the backend', () => {
    expect(temperatureForSoundSpeed(343)).toBeCloseTo(19.6, 1);
    expect(temperatureForSoundSpeed(331.3)).toBeCloseTo(0, 6);
  });

  it('matches and toggles edges by position, in either direction', () => {
    const edge = [0, 0, 0, 2, 0, 0];
    expect(sameEdge(edge, [2, 0, 0, 0, 0, 0])).toBe(true);
    expect(sameEdge(edge, [0, 0.01, 0, 2, 0, 0])).toBe(true);
    expect(sameEdge(edge, [0, 0.1, 0, 2, 0.1, 0])).toBe(false);
    const off = toggleExcludedEdge(undefined, edge);
    expect(off).toEqual([edge]);
    expect(toggleExcludedEdge(off, [2, 0, 0, 0, 0, 0])).toEqual([]);
    expect(toggleExcludedEdge(off, [0, 5, 0, 2, 5, 0])).toHaveLength(2);
    expect(off[0]).not.toBe(edge); // a copy: undo history keeps references
  });

  it('summarises only what differs from the defaults', () => {
    expect(engineSummaryRows({ simulation_mode: 'mono' })).toEqual([]);
    const rows = engineSummaryRows({ simulation_mode: 'foa', diffraction: 'udfa', tail: 'eyring', excluded_edges: [[0, 0, 0, 1, 0, 0]], seed: 7 });
    expect(rows.map((r) => r.label)).toEqual(['Edge Diffraction', 'Edges Switched Off', 'Reverb Tail', 'Seed']);
    // the tail only matters for ambisonic output
    expect(engineSummaryRows({ simulation_mode: 'mono', tail: 'eyring' })).toEqual([]);
  });
});

const info = (over: Partial<HybridRunInfo> = {}): HybridRunInfo => ({
  crossover_hz: 234, wave_fmax: 351, schroeder_hz: 234, rt60: 0.41, volume_m3: 30, mode: 'schroeder', factor: 1,
  limited_by: null, notes: [], median_overlap_mismatch_db: 1.2, level_match: false, ...over,
});

describe('hybrid crossover', () => {
  it('computes the Schroeder frequency', () => {
    expect(schroederFrequency(1, 100)).toBeCloseTo(200);
    expect(schroederFrequency(0.5, 200)).toBeCloseTo(100);
    expect(schroederFrequency(null, 100)).toBeNull();
    expect(schroederFrequency(1, 0)).toBeNull();
  });

  it('plans the crossover like the backend', () => {
    const s = defaultHybridSettings();
    expect(planCrossover(s, 200)).toEqual({ crossoverHz: 200, waveFmax: 200 * HYBRID.WAVE_FMAX_MARGIN, limited: false });
    expect(planCrossover({ ...s, crossover_factor: 2 }, 200)?.crossoverHz).toBe(400);
    expect(planCrossover(s, null)).toBeNull(); // unknown room: measured when it runs
    expect(planCrossover({ ...s, crossover_mode: 'manual', crossover_hz: 315 }, null)?.crossoverHz).toBe(315);
    // a wave cap lowers the crossover, never the reverse
    const capped = planCrossover({ ...s, wave_fmax_cap: 300 }, 400);
    expect(capped).toEqual({ crossoverHz: 300 / HYBRID.WAVE_FMAX_MARGIN, waveFmax: 300, limited: true });
    // a very large hall: the crossover floor, and the solver's own minimum band
    const hall = planCrossover(s, 20);
    expect(hall?.crossoverHz).toBe(HYBRID.CROSSOVER_HZ_MIN);
    expect(hall?.waveFmax).toBe(100);
    expect(hall?.limited).toBe(true);
  });

  it('builds the run form', () => {
    const fields = hybridFormFields({ ...defaultHybridSettings(), diffraction: 'udfa', engine: 'pyroomacoustics', ambisonic_order: 3 }, 343);
    expect(fields.crossover_mode).toBe('schroeder');
    expect(fields.crossover_hz).toBeUndefined(); // only for a manual crossover
    expect(fields.duration).toBeUndefined();     // from the room's decay
    expect(fields.diffraction).toBe('udfa');
    expect(fields.engine).toBeUndefined();       // always compas_acoustics
    expect(fields.ambisonic_order).toBeUndefined();
    expect(fields.sound_speed).toBe('343');
    const manual = hybridFormFields({ ...defaultHybridSettings(), crossover_mode: 'manual', crossover_hz: 150, duration: 0.8 }, 343);
    expect(manual.crossover_hz).toBe('150');
    expect(manual.duration).toBe('0.8');
  });

  it('restores saved settings, defaulting what is missing or out of range', () => {
    expect(restoreHybridSettings(undefined)).toEqual(defaultHybridSettings());
    const restored = restoreHybridSettings({
      simulation_mode: 'hoa', crossover_mode: 'manual', crossover_hz: 99999, crossover_factor: -3, duration: 0.6,
      diffraction: 'udfa', excluded_edges: [[0, 0, 0, 1, 0, 0]],
    });
    expect(restored.simulation_mode).toBe('mono'); // the hybrid has no HOA
    expect(restored.crossover_mode).toBe('manual');
    expect(restored.crossover_hz).toBe(HYBRID.CROSSOVER_HZ_MAX);
    expect(restored.crossover_factor).toBe(HYBRID.CROSSOVER_FACTOR_MIN);
    expect(restored.duration).toBe(0.6);
    expect(restored.diffraction).toBe('udfa');
    expect(restored.excluded_edges).toEqual([[0, 0, 0, 1, 0, 0]]);
  });

  it('reads out the crossover before and after a run', () => {
    const s = defaultHybridSettings();
    expect(crossoverReadout(s, null)).toContain('measured from the room');
    expect(crossoverReadout(s, info())).toContain('crossover 234 Hz');
    expect(crossoverReadout({ ...s, crossover_mode: 'manual', crossover_hz: 150 }, null)).toContain('Wave below 150 Hz');
    expect(crossoverReadout({ ...s, crossover_mode: 'manual', crossover_hz: 900 }, null)).toContain('capped');
    expect(hybridRunSummary(info())).toBe('Last run: T60 0.41 s, 30 m³ → Schroeder 234 Hz · joined at 234 Hz · wave +1.2 dB vs rays at the join');
    expect(hybridRunSummary(info({ rt60: null, schroeder_hz: null, median_overlap_mismatch_db: null }))).toBe('Last run · joined at 234 Hz');
  });

  it('warns when the two parts disagree at the join', () => {
    expect(mismatchWarning(info())).toBeNull();
    expect(mismatchWarning(null)).toBeNull();
    expect(mismatchWarning(info({ median_overlap_mismatch_db: 6.3 }))).toContain('6.3 dB louder');
    expect(mismatchWarning(info({ median_overlap_mismatch_db: -5 }))).toContain('quieter');
    expect(mismatchWarning(info({ median_overlap_mismatch_db: 6.3, level_match: true }))).toBeNull();
  });
});

describe('per-band metrics', () => {
  it('averages the pairs band by band and flags short decays', async () => {
    const { aggregateBandMetrics, formatBandFrequency } = await import('./band-metrics');
    const bands = (t30: Array<number | null>, ok: boolean[]) => ({
      acoustic_parameters_bands: { T30: t30, D50: [50, 60], reliability: { freqs: [500, 1000], T30_reliable: ok } },
    });
    const out = aggregateBandMetrics([bands([1.0, 2.0], [true, true]), bands([2.0, null], [true, false]), {}]);
    expect(out?.frequencies).toEqual([500, 1000]);
    expect(out?.values.T30).toEqual([1.5, 2.0]);   // a pair without a value does not vote
    expect(out?.values.D50).toEqual([50, 60]);
    expect(out?.values.STI).toEqual([null, null]);
    expect(out?.unreliableT30).toEqual([false, true]);
    expect(out?.pairs).toBe(2);
    expect(aggregateBandMetrics([{}, { acoustic_parameters_bands: null }])).toBeNull();
    expect(aggregateBandMetrics(undefined)).toBeNull();
    expect(formatBandFrequency(500)).toBe('500');
    expect(formatBandFrequency(2000)).toBe('2k');
  });
});
