/**
 * Timing ops of the scene edit chat. Orchestrated cards are pinned by giving
 * their trigger absolute MM:SS expressions (the bake places them there and the
 * end-of-turn re-orchestration is told to keep absolute entries); cards without
 * orchestrate meta get an explicit DAW schedule.
 */

import { useAnalysisStore, useAudioControlsStore, useUIStore } from '@/store';
import type { SceneEditOp } from '@/types/sceneEdit';
import type { SoundGenerationConfig } from '@/types';
import { SCENE_EDIT } from '@/utils/constants';
import { MS_PER_SECOND } from '@/utils/sceneWorkflow';
import { clamp, configAt, patchConfig, resolveTargets, type SceneEditApplyContext } from './applyContext';
import { cardSpeechLines, cardTrackId, formatMmSs, isBackgroundCategory, isSpeechCard } from './sceneCards';
import { cardTimes } from './snapshot';

/** Variant per occurrence, rotating through the card's copies (1-based). */
function rotatingVariants(count: number, copies: number): number[] {
  return Array.from({ length: count }, (_, i) => (i % Math.max(1, copies)) + 1);
}

/**
 * Pin card `index` to start at `times` (s). Speech cards keep one occurrence per
 * line: missing times chain after the previous line, extra times are dropped.
 */
export function setCardTimes(index: number, times: number[]): void {
  const config = configAt(index);
  if (!config) return;
  const sorted = [...times].sort((a, b) => a - b);
  const meta = config.orchestrateMeta;
  const speech = isSpeechCard(config);
  const count = speech ? Math.max(1, cardSpeechLines(config).length) : sorted.length;
  const pinned = sorted.slice(0, count);
  const authored = pinned.map(formatMmSs);

  const patch: Partial<SoundGenerationConfig> = { timestamps: authored };
  if (config.scenarioSource) patch.scenarioSource = { ...config.scenarioSource, timestamps: authored };
  if (meta) {
    const expression = Array.from({ length: count }, (_, i) =>
      i < pinned.length ? authored[i] : `after(${meta.entryId}#${i})`,
    );
    patch.orchestrateMeta = {
      ...meta,
      trigger: {
        type: pinned.length === count ? 'absolute' : 'mixed',
        expression,
        delay: expression.map(() => 0),
      },
      variants: speech
        ? Array.from({ length: count }, (_, i) => i + 1)
        : rotatingVariants(count, config.seed_copies ?? 1),
      timestamps: authored,
    };
  }
  patchConfig(index, patch);

  const trackId = cardTrackId(index);
  if (!trackId) return;
  if (meta) {
    // The bake re-derives the schedule from the new trigger.
    useAudioControlsStore.getState().clearSoundTimestampsEntry(trackId);
  } else {
    useAudioControlsStore.getState().handleTimestampsChange(trackId, pinned);
  }
}

function evenlySpaced(count: number, durationS: number): number[] {
  const step = durationS / count;
  return Array.from({ length: count }, (_, i) => step * (i + SCENE_EDIT.DENSITY_START_FRACTION));
}

function withTargets(
  ctx: SceneEditApplyContext,
  op: SceneEditOp,
  fn: (index: number, current: number[]) => number[] | null,
): boolean {
  let applied = false;
  resolveTargets(ctx, op).forEach((index) => {
    const config = configAt(index);
    if (!config) return;
    if (isBackgroundCategory(config.category)) {
      ctx.warnings.push(`${config.display_name ?? 'A background'} plays for the whole scene — its timing is fixed`);
      return;
    }
    const next = fn(index, cardTimes(config, cardTrackId(index)));
    if (!next) return;
    if (next.length === 0) {
      ctx.warnings.push(`${config.display_name ?? 'A sound'} would have no occurrence left — remove it instead`);
      return;
    }
    setCardTimes(index, next.map((t) => clamp(t, 0, ctx.durationS)));
    applied = true;
  });
  if (applied) ctx.needsOrchestrate = true;
  return applied;
}

function setSceneDuration(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  if (op.seconds === null) return false;
  const ms = Math.round(op.seconds * MS_PER_SECOND);
  useAnalysisStore.getState().handleUpdateConfig(ctx.usageIndex, { timelineDurationMs: ms });
  // The DAW length follows the powered scene only.
  if (useUIStore.getState().activeSoundParentIndex === ctx.usageIndex) {
    useAudioControlsStore.getState().setTimelineDurationMs(ms);
  }
  ctx.durationS = op.seconds;
  ctx.needsOrchestrate = true;
  return true;
}

/** Apply a timing op; returns false when nothing changed. */
export function applyTimingOp(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  switch (op.op) {
    case 'set_times':
      return withTargets(ctx, op, () => op.times_s);
    case 'shift':
      return withTargets(ctx, op, (_, current) => current.map((t) => t + (op.delta_s ?? 0)));
    case 'set_density':
      return withTargets(ctx, op, () => {
        const count = op.count ?? Math.max(1, Math.floor(ctx.durationS / (op.interval_s ?? ctx.durationS)));
        return evenlySpaced(count, ctx.durationS);
      });
    case 'remove_occurrences':
      return withTargets(ctx, op, (_, current) => {
        const rest = [...current];
        op.times_s.forEach((t) => {
          if (rest.length === 0) return;
          let nearest = 0;
          rest.forEach((v, i) => { if (Math.abs(v - t) < Math.abs(rest[nearest] - t)) nearest = i; });
          rest.splice(nearest, 1);
        });
        return rest;
      });
    case 'set_scene_duration':
      return setSceneDuration(ctx, op);
    default:
      return false;
  }
}
