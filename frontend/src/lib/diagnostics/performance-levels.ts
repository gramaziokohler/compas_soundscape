/**
 * Pure meter maths for the performance meter and the emergency guard:
 * per-metric fill (0..1 of the red threshold), colour level with hysteresis,
 * and the overall headroom level.
 */
import { PERFORMANCE_METER } from '@/utils/constants';
import type { MeterLevel, PerformanceMetricId, PerformanceSample } from '@/types';

const T = PERFORMANCE_METER.THRESHOLDS;
const M = PERFORMANCE_METER.MEMORY;
const RANK: Record<MeterLevel, number> = { na: -1, ok: 0, warn: 1, crit: 2 };

export const PERFORMANCE_METRICS: readonly PerformanceMetricId[] = ['mem', 'cpu', 'dsp', 'gpu', 'xrun'];

/** Worse of two levels ('na' loses to any real level). */
export function worstLevel(a: MeterLevel, b: MeterLevel): MeterLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Level of a value against amber / red thresholds (higher = worse, or lower = worse
 * with `lowerIsWorse`). With a previous level, the value must clear the threshold by
 * PERFORMANCE_METER.HYSTERESIS before the level drops back.
 */
export function levelFor(
  value: number | null,
  warn: number,
  crit: number,
  prev: MeterLevel = 'ok',
  lowerIsWorse = false,
): MeterLevel {
  if (value === null || Number.isNaN(value)) return 'na';
  const h = PERFORMANCE_METER.HYSTERESIS;
  const over = (threshold: number, holding: boolean) => {
    const margin = holding ? threshold * h : 0;
    return lowerIsWorse ? value <= threshold + margin : value >= threshold - margin;
  };
  if (over(crit, prev === 'crit')) return 'crit';
  if (over(warn, prev === 'crit' || prev === 'warn')) return 'warn';
  return 'ok';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Amber / red memory thresholds (MB) for this tab: fractions of the JS heap limit (the
 * per-tab ceiling Chrome enforces), capped on small machines by a share of device RAM.
 */
export function memoryThresholds(sample: Pick<PerformanceSample, 'heap' | 'deviceMemoryGB'>): { warn: number; crit: number } {
  const tabLimit = sample.heap?.limitMB ?? M.DEFAULT_TAB_LIMIT_MB;
  let crit = tabLimit * M.CRIT_FRACTION;
  if (sample.deviceMemoryGB) crit = Math.min(crit, sample.deviceMemoryGB * M.MB_PER_GB * M.DEVICE_CRIT_FRACTION);
  return { warn: crit * (M.WARN_FRACTION / M.CRIT_FRACTION), crit };
}

/** Worst main-thread stall in the window: frame gaps (all browsers) or long tasks (Chromium). */
export function stallMs(sample: PerformanceSample): number {
  return Math.max(sample.frames?.worstGapMs ?? 0, sample.longTasks.worstMs);
}

/** Bar fill per metric: the value as a fraction of its red threshold (null = no data). */
export function metricFills(sample: PerformanceSample): Record<PerformanceMetricId, number | null> {
  const audio = sample.audio;
  return {
    mem: clamp01(sample.memoryMB / memoryThresholds(sample).crit),
    cpu: clamp01(stallMs(sample) / T.STALL_MS.CRIT),
    dsp: audio
      ? clamp01(Math.max(audio.convolverNodes / T.CONVOLVERS.CRIT, audio.irRunsPeak / T.IR_LOADS.CRIT))
      : null,
    gpu: sample.contextLost ? 1 : sample.gl ? clamp01(sample.newPrograms / T.NEW_PROGRAMS.CRIT) : null,
    xrun: sample.support.xrun ? clamp01(sample.xruns / T.XRUNS.CRIT) : null,
  };
}

/** Colour level per metric, with hysteresis against the previous levels. */
export function metricLevels(
  sample: PerformanceSample,
  prev: Partial<Record<PerformanceMetricId, MeterLevel>> = {},
): Record<PerformanceMetricId, MeterLevel> {
  const audio = sample.audio;
  const cpuStall = levelFor(stallMs(sample), T.STALL_MS.WARN, T.STALL_MS.CRIT, prev.cpu);
  const cpuFps = sample.frames
    ? levelFor(sample.frames.fps, T.FPS.WARN, T.FPS.CRIT, prev.cpu, true)
    : 'na';
  return {
    mem: (() => {
      const { warn, crit } = memoryThresholds(sample);
      return levelFor(sample.memoryMB, warn, crit, prev.mem);
    })(),
    cpu: worstLevel(cpuStall, cpuFps),
    dsp: audio
      ? worstLevel(
          levelFor(audio.convolverNodes, T.CONVOLVERS.WARN, T.CONVOLVERS.CRIT, prev.dsp),
          levelFor(audio.irRunsPeak, T.IR_LOADS.WARN, T.IR_LOADS.CRIT, prev.dsp),
        )
      : 'na',
    gpu: sample.contextLost
      ? 'crit'
      : sample.gl
        ? levelFor(sample.newPrograms, T.NEW_PROGRAMS.WARN, T.NEW_PROGRAMS.CRIT, prev.gpu)
        : 'na',
    xrun: sample.support.xrun ? levelFor(sample.xruns, T.XRUNS.WARN, T.XRUNS.CRIT, prev.xrun) : 'na',
  };
}

/** Overall headroom: the worst metric level. */
export function headroomLevel(levels: Record<PerformanceMetricId, MeterLevel>): MeterLevel {
  return PERFORMANCE_METRICS.reduce<MeterLevel>((worst, id) => worstLevel(worst, levels[id]), 'na');
}
