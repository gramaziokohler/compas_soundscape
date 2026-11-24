/**
 * Interval settings for a recurring activity (foley `recurrence`).
 *
 * A recurring track is orchestrated as a trigger chain: occurrence 1 follows its
 * start / cause, occurrence k is `after(<self>#k-1)` + gap_k (backend
 * utils/recurrence.py). The DAW "Interval settings" panel edits those gaps — not
 * the timestamps — so the chain keeps following its cause sound and a later
 * re-orchestration keeps the user's rhythm (`recurrence.gaps`).
 */

import type { FoleyRecurrence } from '@/types/analysis';
import type { SoundGenerationConfig } from '@/types';
import { UI_INTERVAL_SLIDER, UI_VARIABILITY_SLIDER } from '@/utils/constants';
import { computeIterationJitter } from './timeline-utils';

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Slider values that describe the LLM's gaps: mean gap and the largest deviation from it. */
export function recurrenceIntervalSeed(recurrence: FoleyRecurrence): { intervalSec: number; jitterSec: number } {
  const gaps = recurrence.gaps ?? [];
  if (gaps.length === 0) return { intervalSec: UI_INTERVAL_SLIDER.MIN, jitterSec: 0 };
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const spread = Math.max(...gaps.map((g) => Math.abs(g - mean)));
  return {
    intervalSec: Math.min(UI_INTERVAL_SLIDER.MAX, roundTo(mean, UI_INTERVAL_SLIDER.STEP)),
    jitterSec: Math.min(UI_VARIABILITY_SLIDER.MAX, roundTo(spread, UI_VARIABILITY_SLIDER.STEP)),
  };
}

/** `count − 1` end-to-start gaps: interval ± a stable per-occurrence offset of up to `jitterSec`. */
export function recurrenceGaps(soundId: string, count: number, intervalSec: number, jitterSec: number): number[] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, k) => {
    const gap = intervalSec + computeIterationJitter(soundId, k + 1, jitterSec);
    return Math.round(Math.max(0, gap) * 100) / 100;
  });
}

/**
 * The card fields after applying new gaps: the trigger delays of occurrences
 * 2..n and `scenarioSource.recurrence.gaps`. `null` when the card is not a
 * recurring, orchestrated track.
 */
export function withRecurrenceGaps(
  config: SoundGenerationConfig,
  gaps: number[],
): Pick<SoundGenerationConfig, 'orchestrateMeta' | 'scenarioSource'> | null {
  const meta = config.orchestrateMeta;
  const source = config.scenarioSource;
  if (!meta || !source?.recurrence) return null;
  const delay = meta.trigger.expression.map((_, i) => (i === 0 ? (meta.trigger.delay?.[0] ?? 0) : gaps[i - 1] ?? 0));
  return {
    orchestrateMeta: { ...meta, trigger: { ...meta.trigger, delay } },
    scenarioSource: { ...source, recurrence: { ...source.recurrence, gaps: gaps.slice(0, delay.length - 1) } },
  };
}
