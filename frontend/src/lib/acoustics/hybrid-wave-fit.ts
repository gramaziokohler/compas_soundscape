/**
 * The fitted wave parameters of a hybrid run (backend utils/hybrid_wave_fit.py): when the card's wave
 * grid does not fit the GPU, or a source / listener near a surface forces a finer grid, the job runs a
 * fitted set (`applied`) and reports both options. The Run tab offers the other one; the Setup tab
 * draws the values the run actually uses as orange "used" lines.
 */

import { HYBRID } from '@/utils/constants';
import type { HybridSettings, HybridSimulationConfig, HybridWaveAdjustment, HybridWaveOption } from '@/types/acoustics';

const OPTION_KEYS: ReadonlyArray<HybridWaveOption['key']> = ['conservative', 'optimized'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function toOption(raw: unknown): HybridWaveOption | null {
  if (!isRecord(raw)) return null;
  const { key, label, detail, precision } = raw;
  if (!OPTION_KEYS.includes(key as HybridWaveOption['key']) || typeof label !== 'string' || typeof detail !== 'string') return null;
  if (precision !== 'single' && precision !== 'double') return null;
  const numbers = ['crossover_hz', 'ppw', 'wave_fmax', 'run_ppw', 'h', 'gpu_gb', 'budget_gb', 'runtime_s'] as const;
  if (!numbers.every((k) => isNumber(raw[k]))) return null;
  return raw as unknown as HybridWaveOption; // every field checked above
}

/** The fitted wave parameters of a job's progress `partial` (or a results header); null when none. */
export function waveAdjustmentFrom(container: unknown): HybridWaveAdjustment | null {
  if (!isRecord(container)) return null;
  const raw = container[HYBRID.WAVE_ADJUSTMENT_KEY];
  if (!isRecord(raw) || (raw.reason !== 'gpu' && raw.reason !== 'clearance') || typeof raw.message !== 'string') return null;
  if (!isRecord(raw.requested) || !Array.isArray(raw.options)) return null;
  const options = raw.options.map(toOption).filter((o): o is HybridWaveOption => o !== null);
  const key = (k: unknown) => (OPTION_KEYS.includes(k as HybridWaveOption['key']) ? (k as HybridWaveOption['key']) : null);
  const req = raw.requested;
  return {
    reason: raw.reason,
    message: raw.message,
    requested: {
      crossover_hz: isNumber(req.crossover_hz) ? req.crossover_hz : 0,
      ppw: isNumber(req.ppw) ? req.ppw : 0,
      precision: req.precision === 'single' ? 'single' : 'double',
    },
    options,
    recommended: key(raw.recommended),
    applied: key(raw.applied),
  };
}

/** The card's current fit: the running job's, else the last finished run's. */
export function cardWaveAdjustment(config: HybridSimulationConfig): HybridWaveAdjustment | null {
  if (config.isRunning) return config.waveAdjustment ?? null;
  return config.waveAdjustment ?? waveAdjustmentFrom(config.hybridInfo);
}

/** The option the run uses (null when none runs). */
export function appliedWaveOption(adjustment: HybridWaveAdjustment | null): HybridWaveOption | null {
  if (!adjustment?.applied) return null;
  return adjustment.options.find((o) => o.key === adjustment.applied) ?? null;
}

/** Card settings that make the next run use `option` (a chosen crossover is a manual one). */
export function settingsForWaveOption(settings: HybridSettings, option: HybridWaveOption): HybridSettings {
  return { ...settings, crossover_mode: 'manual', crossover_hz: option.crossover_hz, ppw: option.ppw, precision: option.precision };
}

/**
 * The values the run actually uses where they differ from what the card shows (orange "used" lines
 * on the Setup tab): the crossover, the points per wavelength (after any refinement) and the precision.
 * Null fields = the run uses the card's value.
 */
export function usedWaveValues(
  adjustment: HybridWaveAdjustment | null,
  shownCrossoverHz: number,
  settings: HybridSettings,
): { crossoverHz: number | null; ppw: number | null; precision: HybridWaveOption['precision'] | null; option: HybridWaveOption } | null {
  const option = appliedWaveOption(adjustment);
  if (!option) return null;
  const crossoverHz = Math.abs(option.crossover_hz - shownCrossoverHz) >= HYBRID.CROSSOVER_HZ_STEP / 2 ? option.crossover_hz : null;
  const ppw = Math.abs(option.run_ppw - settings.ppw) >= 0.5 ? option.run_ppw : null;
  const precision = option.precision !== settings.precision ? option.precision : null;
  if (crossoverHz === null && ppw === null && precision === null) return null;
  return { crossoverHz, ppw, precision, option };
}
