import type { SettingsRow } from '@/components/ui/SettingsSummary';
import type { EngineSimulationConfig, GeometricEngineSettings } from '@/types/acoustics';
import { engineSummaryRows } from '@/lib/acoustics/geometric-engine';
import { GA_ENGINE } from '@/utils/constants';

/** Geometric (image sources + rays) part: its main fields, always shown. */
interface GeometricMainSettings extends GeometricEngineSettings {
  simulation_mode: string;
  max_order: number;
  ray_tracing: boolean;
  n_rays: number;
  air_absorption: boolean;
}

const yesNo = (on: boolean): string => (on ? 'Yes' : 'No');

function geometricRows(s: GeometricMainSettings): SettingsRow[] {
  const diffraction = s.diffraction ?? GA_ENGINE.DIFFRACTION_OFF;
  return [
    { label: 'Image-source order', value: String(s.max_order) },
    { label: 'Air absorption', value: yesNo(s.air_absorption) },
    { label: 'Ray tracing', value: s.ray_tracing ? `${s.n_rays.toLocaleString()} rays` : 'No' },
    {
      label: 'Edge diffraction',
      value: diffraction === GA_ENGINE.DIFFRACTION_OFF ? 'Off' : GA_ENGINE.DIFFRACTION_NAMES[diffraction] ?? diffraction,
    },
    // Reverb tail + the "Additional settings" (engine, slopes, air, seed): only when not default.
    ...engineSummaryRows(s).filter((row) => row.label !== 'Edge Diffraction'),
  ];
}

/**
 * Read-only "Simulation settings" recap of a generated engine simulation card
 * (share view): how long it took, then the settings it was run with. Like the
 * wave-based card, the main fields are always listed; the geometric
 * "Additional settings" only when they differ from their default.
 *
 * Usage:
 * ```ts
 * const rows = getSimulationSettingsRows(config, solveTimeSeconds !== null ? formatElapsed(solveTimeSeconds) : null);
 * ```
 */
export function getSimulationSettingsRows(config: EngineSimulationConfig, solvedIn: string | null): SettingsRow[] {
  const rows: SettingsRow[] = solvedIn ? [{ label: 'Solved in', value: solvedIn }] : [];

  if (config.type === 'pyroomacoustics') {
    rows.push(...geometricRows(config.settings));
  } else if (config.type === 'pffdtd') {
    const s = config.settings;
    rows.push(
      { label: 'Max frequency', value: `${s.fmax} Hz` },
      { label: 'Points per wavelength', value: String(s.ppw) },
      { label: 'IR duration', value: `${s.duration} s` },
      { label: 'Air absorption', value: yesNo(s.air_absorption) },
    );
  } else {
    const s = config.settings;
    rows.push(
      {
        label: 'Crossover',
        value: config.hybridInfo
          ? `${Math.round(config.hybridInfo.crossover_hz)} Hz`
          : s.crossover_mode === 'manual'
            ? `${s.crossover_hz} Hz`
            : `${s.crossover_factor === 1 ? '' : `${s.crossover_factor} × `}Schroeder frequency`,
      },
      { label: 'Points per wavelength', value: String(s.ppw) },
      { label: 'Wave IR length', value: s.duration === null ? 'From the decay' : `${s.duration} s` },
      ...geometricRows(s),
    );
  }
  return rows;
}
