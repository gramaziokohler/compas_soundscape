/**
 * Hybrid (wave + geometric) simulation: defaults, the Schroeder frequency, the form fields of its
 * run, and the read-outs of the card. Mirrors backend/utils/hybrid_crossover.py.
 */

import {
  HYBRID,
  PFFDTD,
  PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_DEFAULT_PARALLEL,
  PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
  PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
} from '@/utils/constants';
import {
  engineFormFields,
  pickGeometricEngineSettings,
} from '@/lib/acoustics/geometric-engine';
import type { HybridRunInfo, HybridSettings } from '@/types/acoustics';

export function defaultHybridSettings(): HybridSettings {
  return {
    simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    crossover_mode: HYBRID.CROSSOVER_MODE_DEFAULT,
    crossover_hz: HYBRID.CROSSOVER_HZ_DEFAULT,
    crossover_factor: HYBRID.CROSSOVER_FACTOR_DEFAULT,
    level_match: HYBRID.LEVEL_MATCH_DEFAULT,
    ppw: HYBRID.DEFAULT_PPW,
    duration: null,
    precision: PFFDTD.DEFAULT_PRECISION,
    max_order: PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
    ray_tracing: PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
    n_rays: PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
    air_absorption: PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
    parallel: PYROOMACOUSTICS_DEFAULT_PARALLEL,
  };
}

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

/** Saved settings (any shape) as valid hybrid settings: missing or out-of-range fields take their default. */
export function restoreHybridSettings(saved: Partial<HybridSettings> | null | undefined): HybridSettings {
  const d = defaultHybridSettings();
  const s = saved ?? {};
  const num = (value: unknown, fallback: number, lo: number, hi: number) =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
  const geometric = pickGeometricEngineSettings(s);
  return {
    ...d,
    ...geometric,
    simulation_mode: s.simulation_mode === PYROOMACOUSTICS_SIMULATION_MODE_FOA
      ? PYROOMACOUSTICS_SIMULATION_MODE_FOA : PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    crossover_mode: s.crossover_mode === 'manual' ? 'manual' : 'schroeder',
    crossover_hz: num(s.crossover_hz, d.crossover_hz, HYBRID.CROSSOVER_HZ_MIN, HYBRID.CROSSOVER_HZ_MAX),
    crossover_factor: num(s.crossover_factor, d.crossover_factor, HYBRID.CROSSOVER_FACTOR_MIN, HYBRID.CROSSOVER_FACTOR_MAX),
    level_match: typeof s.level_match === 'boolean' ? s.level_match : d.level_match,
    ppw: num(s.ppw, d.ppw, PFFDTD.PPW_MIN, PFFDTD.PPW_MAX),
    duration: typeof s.duration === 'number' ? clamp(s.duration, PFFDTD.DURATION_MIN, PFFDTD.DURATION_MAX) : null,
    // saves from before the setting ran in double
    precision: s.precision === 'single' ? 'single' : saved ? 'double' : d.precision,
    max_order: num(s.max_order, d.max_order, 0, 20),
    ray_tracing: typeof s.ray_tracing === 'boolean' ? s.ray_tracing : d.ray_tracing,
    n_rays: num(s.n_rays, d.n_rays, 1, 1e7),
    air_absorption: typeof s.air_absorption === 'boolean' ? s.air_absorption : d.air_absorption,
    parallel: typeof s.parallel === 'boolean' ? s.parallel : d.parallel,
  };
}

/** 2000·√(T60 / V) in Hz; null when either is unknown. */
export function schroederFrequency(rt60: number | null | undefined, volume: number | null | undefined): number | null {
  if (!rt60 || !volume || rt60 <= 0 || volume <= 0 || !Number.isFinite(rt60) || !Number.isFinite(volume)) return null;
  return 2000 * Math.sqrt(rt60 / volume);
}

/** Crossover and wave band a room would get with these settings (the backend's rule). */
export function planCrossover(
  settings: Pick<HybridSettings, 'crossover_mode' | 'crossover_hz' | 'crossover_factor'>,
  schroederHz: number | null,
): { crossoverHz: number; waveFmax: number; limited: boolean } | null {
  const target = settings.crossover_mode === 'manual'
    ? settings.crossover_hz
    : schroederHz === null ? null : settings.crossover_factor * schroederHz;
  if (target === null) return null;
  const crossover = clamp(target, HYBRID.CROSSOVER_HZ_MIN, HYBRID.CROSSOVER_HZ_MAX);
  const waveFmax = clamp(crossover * HYBRID.WAVE_FMAX_MARGIN, PFFDTD.FMAX_MIN, PFFDTD.FMAX_MAX);
  return { crossoverHz: crossover, waveFmax, limited: crossover !== target };
}

/**
 * GPU limits of the hybrid's wave part from the largest fmax · PPW that fits (pffdtdMaxGridProduct).
 * The wave part runs to WAVE_FMAX_MARGIN × the crossover, so at the card's PPW the crossover can rise
 * to maxProduct / (margin · PPW), and at the planned wave band the PPW to maxProduct / waveFmax. The
 * wave band is capped at PFFDTD.FMAX_MAX: once that cap fits, any crossover does. Each limit is null
 * when unknown (no GPU answer yet, no room for the Schroeder factor, no crossover plan for the PPW).
 */
export function hybridGpuLimits(
  maxProduct: number | null,
  ppw: number,
  waveFmax: number | null,
  schroederHz: number | null,
): { ppwMax: number | null; crossoverHzMax: number | null; factorMax: number | null } {
  if (maxProduct === null) return { ppwMax: null, crossoverHzMax: null, factorMax: null };
  const waveFmaxMax = maxProduct / ppw;
  const crossoverHzMax = waveFmaxMax >= PFFDTD.FMAX_MAX
    ? Infinity
    : waveFmaxMax < PFFDTD.FMAX_MIN ? 0 : waveFmaxMax / HYBRID.WAVE_FMAX_MARGIN;
  return {
    ppwMax: waveFmax === null ? null : maxProduct / waveFmax,
    crossoverHzMax,
    factorMax: schroederHz === null ? null : crossoverHzMax / schroederHz,
  };
}

/**
 * Eyring estimate of the Schroeder frequency from the acoustic region's bounding box and the
 * low-frequency absorption of the assigned materials, before any run has measured the room.
 * T60 = 0.161·V / (−S·ln(1 − ᾱ)) with V and S the box's volume and surface; null when the box
 * is missing or degenerate.
 */
export interface EyringRoomEstimate {
  schroederHz: number;
  rt60: number;
  volume: number;
}

export function estimateSchroederEyring(
  bounds: { min: [number, number, number]; max: [number, number, number] } | null | undefined,
  meanAbsorption: number,
): EyringRoomEstimate | null {
  if (!bounds) return null;
  const [dx, dy, dz] = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]);
  const volume = dx * dy * dz;
  const surface = 2 * (dx * dy + dy * dz + dz * dx);
  if (!(volume > 0) || !(surface > 0)) return null;
  const alpha = clamp(meanAbsorption, HYBRID.ESTIMATE_ABSORPTION_MIN, HYBRID.ESTIMATE_ABSORPTION_MAX);
  const rt60 = (HYBRID.SABINE_CONSTANT * volume) / (-surface * Math.log(1 - alpha));
  const schroederHz = schroederFrequency(rt60, volume);
  return schroederHz === null ? null : { schroederHz, rt60, volume };
}

/**
 * Mean absorption the Eyring estimate uses: per assigned material, the mean of its octave-band
 * coefficients up to HYBRID.ESTIMATE_MAX_BAND_HZ (the Schroeder range), else its broadband value;
 * averaged over the assigned objects. HYBRID.ESTIMATE_MEAN_ABSORPTION when nothing is assigned.
 */
export function lowFrequencyMeanAbsorption(
  assignedMaterialIds: Iterable<string>,
  materials: ReadonlyArray<{ id: string; absorption: number; coeffs?: number[]; center_freqs?: number[] }>,
): number {
  const byId = new Map(materials.map((m) => [m.id, m]));
  let sum = 0;
  let count = 0;
  for (const id of assignedMaterialIds) {
    const m = byId.get(id);
    if (!m) continue;
    const low = (m.coeffs ?? []).filter((_, i) => (m.center_freqs?.[i] ?? Infinity) <= HYBRID.ESTIMATE_MAX_BAND_HZ);
    sum += low.length > 0 ? low.reduce((a, b) => a + b, 0) / low.length : m.absorption;
    count += 1;
  }
  return count > 0 ? sum / count : HYBRID.ESTIMATE_MEAN_ABSORPTION;
}

/** The room a run plans its Schroeder crossover with, sent with it (both parts then start at once). */
export interface HybridRoom {
  rt60: number;
  volume: number;
  /** Where it comes from, reported back as the run's `rt60_source` */
  source: string;
}

/** The last run's Schroeder frequency as measured on its geometric responses (older runs: the one they joined with). */
export function lastRunSchroederHz(info: HybridRunInfo | null | undefined): number | null {
  return info?.measured_schroeder_hz ?? info?.schroeder_hz ?? null;
}

/**
 * The room the next run plans with: the last run's measured decay, else the Eyring estimate of the
 * acoustic region; null when neither is known (the backend then predicts it from the mesh).
 */
export function hybridRoomForRun(info: HybridRunInfo | null | undefined, estimate: EyringRoomEstimate | null): HybridRoom | null {
  const rt60 = info?.measured_rt60 ?? info?.rt60 ?? null;
  const volume = info?.volume_m3 ?? null;
  if (rt60 !== null && rt60 > 0 && volume !== null && volume > 0) {
    return { rt60, volume, source: "the last run's room (measured)" };
  }
  if (estimate) return { rt60: estimate.rt60, volume: estimate.volume, source: 'Eyring estimate of the acoustic region' };
  return null;
}

/** Form fields of POST /api/hybrid/run-simulation-speckle for the card's settings. */
export function hybridFormFields(settings: HybridSettings, soundSpeed: number, room: HybridRoom | null = null): Record<string, string> {
  const fields: Record<string, string> = {
    simulation_mode: settings.simulation_mode,
    crossover_mode: settings.crossover_mode,
    crossover_factor: String(settings.crossover_factor),
    level_match: String(settings.level_match),
    ppw: String(settings.ppw),
    precision: settings.precision,
    max_order: String(settings.max_order),
    ray_tracing: String(settings.ray_tracing),
    n_rays: String(settings.n_rays),
    air_absorption: String(settings.air_absorption),
    parallel: String(settings.parallel),
    sound_speed: String(soundSpeed),
    ...engineFormFields(settings),
  };
  if (settings.crossover_mode === 'manual') fields.crossover_hz = String(settings.crossover_hz);
  else if (room) {
    fields.room_rt60 = String(room.rt60);
    fields.room_volume = String(room.volume);
    fields.room_estimate_source = room.source;
  }
  if (settings.duration !== null) fields.duration = String(settings.duration);
  // the hybrid always runs compas_acoustics, at first order at most
  delete fields.engine;
  delete fields.ambisonic_order;
  return fields;
}

const hz = (value: number) => `${Math.round(value)} Hz`;

/**
 * One line under the crossover control: what the next run will do, as far as it is known.
 * `estimatedSchroederHz` (Eyring, from the acoustic region) stands in until a run has measured the room.
 */
export function crossoverReadout(
  settings: HybridSettings,
  info: HybridRunInfo | null,
  estimatedSchroederHz: number | null = null,
): string {
  if (settings.crossover_mode === 'manual') {
    const plan = planCrossover(settings, null);
    if (!plan) return '';
    return `Wave below ${hz(plan.crossoverHz)} (solved up to ${hz(plan.waveFmax)}), rays above.`;
  }
  const measured = lastRunSchroederHz(info);
  const plan = planCrossover(settings, measured ?? estimatedSchroederHz);
  if (!plan) return 'The Schroeder frequency, 2000·√(T60 / V), is predicted from the simulation mesh when the run starts.';
  const source = measured !== null ? "With the last run's room" : 'Estimated (Eyring, acoustic layer box)';
  return `${source}: crossover ${hz(plan.crossoverHz)}${plan.limited ? ' (limited)' : ''}, wave solved up to ${hz(plan.waveFmax)}.`;
}

/** What the last run measured and used. */
export function hybridRunSummary(info: HybridRunInfo): string {
  const parts: string[] = [];
  const rt60 = info.measured_rt60 ?? info.rt60;
  const schroeder = lastRunSchroederHz(info);
  if (rt60 !== null && info.volume_m3 !== null && schroeder !== null) {
    parts.push(`Last run: T60 ${rt60.toFixed(2)} s, ${Math.round(info.volume_m3).toLocaleString()} m³ → Schroeder ${hz(schroeder)}`);
  } else {
    parts.push('Last run');
  }
  parts.push(`joined at ${hz(info.crossover_hz)}`);
  if (info.median_overlap_mismatch_db !== null && info.median_overlap_mismatch_db !== undefined) {
    const d = info.median_overlap_mismatch_db;
    parts.push(`wave ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} dB vs rays at the join`);
  }
  return parts.join(' · ');
}

/** A warning when the two parts disagree in level around the crossover, else null. */
export function mismatchWarning(info: HybridRunInfo | null): string | null {
  const d = info?.median_overlap_mismatch_db;
  if (d === null || d === undefined || Math.abs(d) < HYBRID.MISMATCH_WARNING_DB) return null;
  if (info?.level_match) return null;
  return `The wave part is ${Math.abs(d).toFixed(1)} dB ${d > 0 ? 'louder' : 'quieter'} than the rays around the crossover. `
    + 'Check that both parts see the same materials, or turn on "Match levels at the crossover".';
}

/** "Hybrid: wave below 230 Hz, rays above" — the card's result line. */
export function hybridResultLine(info: HybridRunInfo | null | undefined): string {
  return info ? `Wave below ${hz(info.crossover_hz)}, rays above` : 'Wave below the crossover, rays above';
}
