/**
 * usePerformanceMeter — the bottom-bar performance meter's data: subscribes to the
 * shared performance monitor (1 Hz, with frame tracking) only while `enabled`, and
 * derives what the meter draws: smoothed fills (fast attack / slow release), peak-hold
 * ticks, a short history per metric, colour levels with hysteresis and the headroom.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PERFORMANCE_METER } from '@/utils/constants';
import { subscribePerformance } from '@/lib/diagnostics/performance-monitor';
import { PERFORMANCE_METRICS, headroomLevel, metricFills, metricLevels } from '@/lib/diagnostics/performance-levels';
import type { MeterLevel, PerformanceMetricId, PerformanceSample } from '@/types';

type PerMetric<T> = Record<PerformanceMetricId, T>;

export interface PerformanceMeterState {
  sample: PerformanceSample | null;
  /** Smoothed bar fill 0..1 (null = no data for that metric here). */
  display: PerMetric<number | null>;
  peaks: PerMetric<number>;
  history: PerMetric<number[]>;
  levels: PerMetric<MeterLevel>;
  headroom: MeterLevel;
}

export interface UsePerformanceMeterReturn {
  state: PerformanceMeterState;
  methods: { resetPeaks: () => void };
}

function perMetric<T>(make: () => T): PerMetric<T> {
  return Object.fromEntries(PERFORMANCE_METRICS.map((id) => [id, make()])) as PerMetric<T>;
}

const EMPTY: PerformanceMeterState = {
  sample: null,
  display: perMetric<number | null>(() => null),
  peaks: perMetric(() => 0),
  history: perMetric<number[]>(() => []),
  levels: perMetric<MeterLevel>(() => 'na'),
  headroom: 'na',
};

export function usePerformanceMeter(enabled: boolean): UsePerformanceMeterReturn {
  const [state, setState] = useState<PerformanceMeterState>(EMPTY);
  const peakAt = useRef<PerMetric<number>>(perMetric(() => 0));
  const lastT = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    return subscribePerformance({
      intervalMs: PERFORMANCE_METER.SAMPLE_INTERVAL_MS,
      needsFrames: true,
      onSample: (sample) => {
        const fills = metricFills(sample);
        const dtS = lastT.current === null ? 0 : (sample.t - lastT.current) / 1000;
        lastT.current = sample.t;
        setState((prev) => {
          const levels = metricLevels(sample, prev.levels);
          const display = { ...prev.display };
          const peaks = { ...prev.peaks };
          const history = { ...prev.history };
          for (const id of PERFORMANCE_METRICS) {
            const target = fills[id];
            if (target === null) {
              display[id] = null;
              continue;
            }
            const before = prev.display[id] ?? 0;
            const k = target > before ? PERFORMANCE_METER.SMOOTH_RISE : PERFORMANCE_METER.SMOOTH_FALL;
            display[id] = before + (target - before) * k;

            if (target >= peaks[id]) {
              peaks[id] = target;
              peakAt.current[id] = sample.t;
            } else if (sample.t - peakAt.current[id] > PERFORMANCE_METER.PEAK_HOLD_MS) {
              peaks[id] = Math.max(target, peaks[id] - PERFORMANCE_METER.PEAK_DECAY_PER_S * dtS);
            }
            history[id] = [...prev.history[id], target].slice(-PERFORMANCE_METER.HISTORY_LENGTH);
          }
          return { sample, display, peaks, history, levels, headroom: headroomLevel(levels) };
        });
      },
    });
  }, [enabled]);

  const resetPeaks = useCallback(() => {
    setState((prev) => ({ ...prev, peaks: perMetric(() => 0) }));
  }, []);

  return { state, methods: { resetPeaks } };
}
