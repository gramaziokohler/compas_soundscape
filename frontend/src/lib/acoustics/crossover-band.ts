/**
 * Pure helpers of the crossover band (Hybrid simulation 2): the log frequency axis, the handle's
 * snapping to the recommended crossover, the GPU limit of the wave part and the decorative curves.
 */

import { HYBRID, HYBRID_BAND, PFFDTD } from '@/utils/constants';
import { planCrossover } from '@/lib/acoustics/hybrid';
import { pffdtdGridSpacing, waveGridFit } from '@/lib/acoustics/pffdtd-grid';
import type { HybridParts, HybridSettings } from '@/types/acoustics';

const LOG_SPAN = Math.log(HYBRID_BAND.AXIS_MAX_HZ / HYBRID_BAND.AXIS_MIN_HZ);

/** Position (0–1) of a frequency on the band's log axis. */
export function bandPosition(hz: number): number {
  const t = Math.log(hz / HYBRID_BAND.AXIS_MIN_HZ) / LOG_SPAN;
  return Math.min(1, Math.max(0, t));
}

/** Frequency at a position (0–1) of the band's log axis. */
export function bandFrequency(position: number): number {
  return HYBRID_BAND.AXIS_MIN_HZ * Math.exp(Math.min(1, Math.max(0, position)) * LOG_SPAN);
}

/** A dragged frequency clamped to the handle's range, snapped to `recommendedHz` when close to it. */
export function snapCrossover(hz: number, recommendedHz: number | null): number {
  const clamped = Math.min(HYBRID.CROSSOVER_HZ_MAX, Math.max(HYBRID.CROSSOVER_HZ_MIN, hz));
  if (recommendedHz !== null && Math.abs(Math.log(clamped / recommendedHz)) < Math.log(1 + HYBRID_BAND.SNAP_RATIO)) {
    return recommendedHz;
  }
  return Math.round(clamped / HYBRID.CROSSOVER_HZ_STEP) * HYBRID.CROSSOVER_HZ_STEP;
}

/** "180 Hz", "1.2 kHz" */
export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
}

/** Axis tick label: "20", "100", "1k", "20k". */
export function tickLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/**
 * Highest handle value whose wave grid still fits the GPU, from the largest fmax · PPW that fits
 * (`maxProduct`, usePffdtdGpuLimit). With both parts the wave part runs to WAVE_FMAX_MARGIN × the
 * crossover; alone it runs to the handle itself. Infinity when the solver's own cap fits; null unknown.
 */
export function bandGpuMaxHz(maxProduct: number | null, ppw: number, parts: HybridParts): number | null {
  if (maxProduct === null || parts === 'rays') return null;
  const waveFmaxMax = maxProduct / ppw;
  if (waveFmaxMax >= PFFDTD.FMAX_MAX) return Infinity;
  return parts === 'wave' ? waveFmaxMax : waveFmaxMax / HYBRID.WAVE_FMAX_MARGIN;
}

/**
 * SVG path (viewBox 0 0 100 100, stretched to the part) of a standing wave whose cycles shorten
 * towards the right, as low-frequency modes do.
 */
export function wavePath(cycles: number, phase = 0): string {
  const steps = 120;
  const points: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = 2 * Math.PI * cycles * t * (0.6 + 0.4 * t) + phase;
    const amplitude = 34 * (1 - 0.45 * t);
    points.push(`${(t * 100).toFixed(2)},${(50 + amplitude * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(' L')}`;
}

/** SVG path (viewBox 0 0 100 100) of a ray bouncing between the band's edges, `bounces` times. */
export function rayPath(bounces: number, offset: number): string {
  const points: string[] = [];
  for (let i = 0; i <= bounces; i += 1) {
    const x = Math.min(100, (i + offset) * (100 / bounces));
    points.push(`${x.toFixed(2)},${i % 2 === 0 ? 8 : 92}`);
  }
  return `M0,${(50 + 40 * (offset - 0.5)).toFixed(2)} L${points.join(' L')}`;
}

/**
 * Where the handle of a hybrid card sits and how far its wave part runs: the planned crossover
 * (the card's manual frequency until the room is known), and the wave band's top (the margin above
 * the crossover with the rays, the handle itself alone, none for rays alone).
 */
export function hybridWaveBand(
  settings: HybridSettings,
  recommendedHz: number | null,
): { crossoverHz: number; waveFmax: number | null } {
  const parts = settings.parts ?? HYBRID.PARTS_DEFAULT;
  const plan = planCrossover(settings, recommendedHz);
  const crossoverHz = plan?.crossoverHz ?? settings.crossover_hz;
  const waveFmax = parts === 'rays' ? null : parts === 'wave' ? crossoverHz : plan?.waveFmax ?? null;
  return { crossoverHz, waveFmax };
}

/**
 * The GPU memory warning of a hybrid card's wave grid (null when it fits, is unknown, or the rays run
 * alone). Hybrid simulation 2 shows it at the top of the card and does not start a run while it is set.
 */
export function hybridWaveGpuWarning(
  settings: HybridSettings,
  recommendedHz: number | null,
  extents: [number, number, number] | null,
  availableBytes: number | null,
): string | null {
  if ((settings.parts ?? HYBRID.PARTS_DEFAULT) === 'rays') return null;
  const { waveFmax } = hybridWaveBand(settings, recommendedHz);
  const h = waveFmax !== null ? pffdtdGridSpacing(waveFmax, settings.ppw) : null;
  return waveGridFit(extents, h, settings.precision, settings.duration, availableBytes).warning;
}
