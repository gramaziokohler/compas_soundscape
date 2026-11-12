/**
 * Settings of the geometric-acoustics card that only the compas_acoustics engine runs
 * (edge diffraction, higher-order ambisonics, the late-field model, air, seed, edge selection).
 *
 * One place decides what is sent to the backend, saved with the soundscape and shown as a
 * summary, so the run, its geometry check and its sound-path preview cannot drift apart.
 */

import {
  AMBISONIC,
  GA_ENGINE,
  PYROOMACOUSTICS_SIMULATION_MODE_FOA,
  PYROOMACOUSTICS_SIMULATION_MODE_HOA,
  PYROOMACOUSTICS_SIMULATION_MODE_MONO,
  SIMULATION_OUTPUT_SOA,
  SIMULATION_OUTPUT_TOA,
} from '@/utils/constants';
import type { GeometricEngineSettings } from '@/types/acoustics';

const KEYS = [
  'engine', 'diffraction', 'ambisonic_order', 'tail', 'n_slopes', 'seed', 'scattering_split',
  'air_temperature', 'air_humidity', 'excluded_edges',
] as const satisfies readonly (keyof GeometricEngineSettings)[];

/** The engine fields that are set on `settings` (undefined ones are left out). */
export function pickGeometricEngineSettings(settings: GeometricEngineSettings | null | undefined): GeometricEngineSettings {
  const out: Record<string, unknown> = {};
  if (!settings) return out;
  for (const key of KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out as GeometricEngineSettings;
}

export interface EngineCapabilities {
  default: string;
  engines: Record<string, {
    available: boolean;
    modes: string[];
    diffraction: string[];
    tails: string[];
    max_ambisonic_order: number;
    paths: string[];
  }>;
}

/** The engine a card will run on: its own choice, else the backend's default. */
export function resolveEngine(settings: GeometricEngineSettings, capabilities: EngineCapabilities | null): string {
  const chosen = settings.engine && settings.engine !== GA_ENGINE.AUTO ? settings.engine : null;
  return chosen ?? capabilities?.default ?? GA_ENGINE.COMPAS_ACOUSTICS;
}

/** True when the card runs on compas_acoustics (the engine with diffraction, HOA and sound paths). */
export function usesCompasAcoustics(settings: GeometricEngineSettings, capabilities: EngineCapabilities | null): boolean {
  const engine = resolveEngine(settings, capabilities);
  if (engine !== GA_ENGINE.COMPAS_ACOUSTICS) return false;
  return capabilities ? !!capabilities.engines[engine]?.available : true;
}

export function isAmbisonicMode(mode: string): boolean {
  return mode === PYROOMACOUSTICS_SIMULATION_MODE_FOA || mode === PYROOMACOUSTICS_SIMULATION_MODE_HOA;
}

/** Ambisonic order of a mode: 0 mono, 1 FOA, the card's order (2-3) for HOA. */
export function ambisonicOrder(mode: string, settings: GeometricEngineSettings): number {
  if (mode === PYROOMACOUSTICS_SIMULATION_MODE_MONO) return 0;
  if (mode === PYROOMACOUSTICS_SIMULATION_MODE_FOA) return 1;
  const order = settings.ambisonic_order ?? GA_ENGINE.AMBISONIC_ORDER_DEFAULT;
  return Math.min(Math.max(Math.round(order), 2), GA_ENGINE.AMBISONIC_ORDER_MAX);
}

export function channelCount(mode: string, settings: GeometricEngineSettings): number {
  return (ambisonicOrder(mode, settings) + 1) ** 2;
}

/**
 * The card's output choice: the simulation mode, with HOA split by order into SOA (order 2) and
 * TOA (order 3). Keys of PYROOMACOUSTICS_SIMULATION_MODE_NAMES.
 */
export function outputChoice(mode: string, settings: GeometricEngineSettings): string {
  if (mode !== PYROOMACOUSTICS_SIMULATION_MODE_HOA) return mode;
  return ambisonicOrder(mode, settings) >= AMBISONIC.ORDER.TOA ? SIMULATION_OUTPUT_TOA : SIMULATION_OUTPUT_SOA;
}

/** The settings an output choice stands for (the backend still receives "hoa" + ambisonic_order). */
export function settingsForOutputChoice(choice: string): { simulation_mode: string; ambisonic_order: number | undefined } {
  if (choice === SIMULATION_OUTPUT_SOA) return { simulation_mode: PYROOMACOUSTICS_SIMULATION_MODE_HOA, ambisonic_order: AMBISONIC.ORDER.SOA };
  if (choice === SIMULATION_OUTPUT_TOA) return { simulation_mode: PYROOMACOUSTICS_SIMULATION_MODE_HOA, ambisonic_order: AMBISONIC.ORDER.TOA };
  return { simulation_mode: choice, ambisonic_order: undefined };
}

/**
 * The settings as the engine can run them: what the legacy engine cannot do is dropped, BTMS falls
 * back to UDFA for mono, HOA falls back to FOA on the legacy engine. `changes` says what was
 * adjusted, for the card to show.
 */
export function effectiveEngineSettings<T extends GeometricEngineSettings & { simulation_mode: string }>(
  settings: T,
  capabilities: EngineCapabilities | null,
): { settings: T; changes: string[] } {
  const changes: string[] = [];
  const out: T = { ...settings };
  const ca = usesCompasAcoustics(settings, capabilities);
  if (!ca) {
    if (out.simulation_mode === PYROOMACOUSTICS_SIMULATION_MODE_HOA) {
      out.simulation_mode = PYROOMACOUSTICS_SIMULATION_MODE_FOA;
      changes.push('Higher-order ambisonics needs compas_acoustics: running first order.');
    }
    if (out.diffraction && out.diffraction !== GA_ENGINE.DIFFRACTION_OFF) {
      out.diffraction = GA_ENGINE.DIFFRACTION_OFF;
      changes.push('Edge diffraction needs compas_acoustics: running without it.');
    }
    return { settings: out, changes };
  }
  if (out.diffraction === 'btms' && !isAmbisonicMode(out.simulation_mode)) {
    out.diffraction = 'udfa';
    changes.push('BTMS diffraction needs an ambisonic output: running UDFA.');
  }
  return { settings: out, changes };
}

/** Form fields of the run endpoint for the engine settings (only what differs from "let the backend decide"). */
export function engineFormFields(settings: GeometricEngineSettings & { simulation_mode: string }): Record<string, string> {
  const fields: Record<string, string> = {};
  if (settings.engine && settings.engine !== GA_ENGINE.AUTO) fields.engine = settings.engine;
  if (settings.diffraction) fields.diffraction = settings.diffraction;
  if (settings.simulation_mode === PYROOMACOUSTICS_SIMULATION_MODE_HOA) {
    fields.ambisonic_order = String(ambisonicOrder(settings.simulation_mode, settings));
  }
  if (settings.tail) fields.tail = settings.tail;
  if (settings.n_slopes !== undefined) fields.n_slopes = String(settings.n_slopes);
  if (settings.seed !== undefined) fields.seed = String(settings.seed);
  if (settings.scattering_split !== undefined) fields.scattering_split = String(settings.scattering_split);
  if (settings.air_temperature !== undefined && settings.air_temperature !== null) {
    fields.air_temperature = String(settings.air_temperature);
  }
  if (settings.air_humidity !== undefined) fields.air_humidity = String(settings.air_humidity);
  if (settings.excluded_edges?.length) fields.excluded_edges = JSON.stringify(settings.excluded_edges);
  return fields;
}

/** Air temperature (deg C) whose speed of sound is `c` m/s — the backend's conversion (dry air). */
export function temperatureForSoundSpeed(c: number): number {
  return 273.15 * ((c / 331.3) ** 2 - 1);
}

/** Same segment whichever end comes first, within `tolerance` metres. */
export function sameEdge(a: readonly number[], b: readonly number[], tolerance = 0.02): boolean {
  const close = (i: number, j: number) =>
    Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1], a[i + 2] - b[j + 2]) <= tolerance;
  return (close(0, 0) && close(3, 3)) || (close(0, 3) && close(3, 0));
}

/** `edges` with `segment` added when absent, removed when present. */
export function toggleExcludedEdge(edges: readonly number[][] | undefined, segment: readonly number[]): number[][] {
  const list = edges ?? [];
  const without = list.filter((e) => !sameEdge(e, segment));
  return without.length === list.length ? [...list, [...segment]] : without;
}

/** Summary rows (label, value) of the engine settings that differ from their defaults. */
export function engineSummaryRows(settings: GeometricEngineSettings & { simulation_mode: string }): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (settings.engine && settings.engine !== GA_ENGINE.AUTO) {
    rows.push({ label: 'Engine', value: GA_ENGINE.NAMES[settings.engine] ?? settings.engine });
  }
  if (settings.diffraction && settings.diffraction !== GA_ENGINE.DIFFRACTION_OFF) {
    rows.push({ label: 'Edge Diffraction', value: GA_ENGINE.DIFFRACTION_NAMES[settings.diffraction] ?? settings.diffraction });
    if (settings.excluded_edges?.length) rows.push({ label: 'Edges Switched Off', value: String(settings.excluded_edges.length) });
  }
  if (isAmbisonicMode(settings.simulation_mode) && settings.tail && settings.tail !== GA_ENGINE.TAIL_DEFAULT) {
    rows.push({ label: 'Reverb Tail', value: GA_ENGINE.TAIL_NAMES[settings.tail] ?? settings.tail });
  }
  if (settings.n_slopes && settings.n_slopes > 1) rows.push({ label: 'Decay Slopes', value: String(settings.n_slopes) });
  if (settings.scattering_split) rows.push({ label: 'Scattered Early Part', value: 'Yes' });
  if (settings.air_temperature !== undefined && settings.air_temperature !== null) {
    rows.push({ label: 'Air Temperature', value: `${settings.air_temperature} °C` });
  }
  if (settings.air_humidity !== undefined && settings.air_humidity !== GA_ENGINE.AIR_HUMIDITY_DEFAULT) {
    rows.push({ label: 'Humidity', value: `${settings.air_humidity} %` });
  }
  if (settings.seed !== undefined && settings.seed !== GA_ENGINE.SEED_DEFAULT) rows.push({ label: 'Seed', value: String(settings.seed) });
  return rows;
}
