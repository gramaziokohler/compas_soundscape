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
import { engineFormFields, pickGeometricEngineSettings } from '@/lib/acoustics/geometric-engine';
import type { HybridRunInfo, HybridSettings } from '@/types/acoustics';

export function defaultHybridSettings(): HybridSettings {
  return {
    simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
    crossover_mode: HYBRID.CROSSOVER_MODE_DEFAULT,
    crossover_hz: HYBRID.CROSSOVER_HZ_DEFAULT,
    crossover_factor: HYBRID.CROSSOVER_FACTOR_DEFAULT,
    wave_fmax_cap: HYBRID.WAVE_FMAX_CAP_DEFAULT,
    level_match: HYBRID.LEVEL_MATCH_DEFAULT,
    ppw: HYBRID.DEFAULT_PPW,
    duration: null,
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
  return {
    ...d,
    ...pickGeometricEngineSettings(s),
    simulation_mode: s.simulation_mode === PYROOMACOUSTICS_SIMULATION_MODE_FOA
      ? PYROOMACOUSTICS_SIMULATION_MODE_FOA : PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    crossover_mode: s.crossover_mode === 'manual' ? 'manual' : 'schroeder',
    crossover_hz: num(s.crossover_hz, d.crossover_hz, HYBRID.CROSSOVER_HZ_MIN, HYBRID.CROSSOVER_HZ_MAX),
    crossover_factor: num(s.crossover_factor, d.crossover_factor, HYBRID.CROSSOVER_FACTOR_MIN, HYBRID.CROSSOVER_FACTOR_MAX),
    wave_fmax_cap: num(s.wave_fmax_cap, d.wave_fmax_cap, HYBRID.WAVE_FMAX_CAP_MIN, HYBRID.WAVE_FMAX_CAP_MAX),
    level_match: typeof s.level_match === 'boolean' ? s.level_match : d.level_match,
    ppw: num(s.ppw, d.ppw, PFFDTD.PPW_MIN, PFFDTD.PPW_MAX),
    duration: typeof s.duration === 'number' ? clamp(s.duration, PFFDTD.DURATION_MIN, PFFDTD.DURATION_MAX) : null,
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
  settings: Pick<HybridSettings, 'crossover_mode' | 'crossover_hz' | 'crossover_factor' | 'wave_fmax_cap'>,
  schroederHz: number | null,
): { crossoverHz: number; waveFmax: number; limited: boolean } | null {
  const target = settings.crossover_mode === 'manual'
    ? settings.crossover_hz
    : schroederHz === null ? null : settings.crossover_factor * schroederHz;
  if (target === null) return null;
  let crossover = clamp(target, HYBRID.CROSSOVER_HZ_MIN, HYBRID.CROSSOVER_HZ_MAX);
  let waveFmax = crossover * HYBRID.WAVE_FMAX_MARGIN;
  let limited = crossover !== target;
  if (waveFmax > settings.wave_fmax_cap) {
    waveFmax = settings.wave_fmax_cap;
    crossover = waveFmax / HYBRID.WAVE_FMAX_MARGIN;
    limited = true;
  }
  return { crossoverHz: crossover, waveFmax: Math.max(waveFmax, PFFDTD.FMAX_MIN), limited };
}

/** Form fields of POST /api/hybrid/run-simulation-speckle for the card's settings. */
export function hybridFormFields(settings: HybridSettings, soundSpeed: number): Record<string, string> {
  const fields: Record<string, string> = {
    simulation_mode: settings.simulation_mode,
    crossover_mode: settings.crossover_mode,
    crossover_factor: String(settings.crossover_factor),
    wave_fmax_cap: String(settings.wave_fmax_cap),
    level_match: String(settings.level_match),
    ppw: String(settings.ppw),
    max_order: String(settings.max_order),
    ray_tracing: String(settings.ray_tracing),
    n_rays: String(settings.n_rays),
    air_absorption: String(settings.air_absorption),
    parallel: String(settings.parallel),
    sound_speed: String(soundSpeed),
    ...engineFormFields(settings),
  };
  if (settings.crossover_mode === 'manual') fields.crossover_hz = String(settings.crossover_hz);
  if (settings.duration !== null) fields.duration = String(settings.duration);
  // the hybrid always runs compas_acoustics, at first order at most
  delete fields.engine;
  delete fields.ambisonic_order;
  return fields;
}

const hz = (value: number) => `${Math.round(value)} Hz`;

/** One line under the crossover control: what the next run will do, as far as it is known. */
export function crossoverReadout(settings: HybridSettings, info: HybridRunInfo | null): string {
  if (settings.crossover_mode === 'manual') {
    const plan = planCrossover(settings, null);
    if (!plan) return '';
    return plan.limited
      ? `Wave solver capped at ${hz(settings.wave_fmax_cap)}: the crossover will be ${hz(plan.crossoverHz)}.`
      : `Wave below ${hz(plan.crossoverHz)} (solved up to ${hz(plan.waveFmax)}), rays above.`;
  }
  const plan = planCrossover(settings, info?.schroeder_hz ?? null);
  if (!plan) return 'The Schroeder frequency, 2000·√(T60 / V), is measured from the room when the simulation runs.';
  return plan.limited
    ? `With the last run's room: crossover ${hz(plan.crossoverHz)} (limited), wave solved up to ${hz(plan.waveFmax)}.`
    : `With the last run's room: crossover ${hz(plan.crossoverHz)}, wave solved up to ${hz(plan.waveFmax)}.`;
}

/** What the last run measured and used. */
export function hybridRunSummary(info: HybridRunInfo): string {
  const parts: string[] = [];
  if (info.rt60 !== null && info.volume_m3 !== null && info.schroeder_hz !== null) {
    parts.push(`Last run: T60 ${info.rt60.toFixed(2)} s, ${Math.round(info.volume_m3).toLocaleString()} m³ → Schroeder ${hz(info.schroeder_hz)}`);
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
