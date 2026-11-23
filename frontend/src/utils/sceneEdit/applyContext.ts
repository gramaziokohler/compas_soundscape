/**
 * State shared by the scene-edit op appliers during one chat turn: ref resolution
 * (snapshot refs and refs of cards added by the plan), the regeneration work the
 * plan leaves for after the synchronous apply, and the turn's labels / warnings.
 */

import { useSoundscapeStore } from '@/store';
import type { SceneEditOp, SceneEditRefMap } from '@/types/sceneEdit';
import type { SoundGenerationConfig } from '@/types';
import { cardIndexByConfigId } from './sceneCards';

/** Audio work queued by the ops, keyed by card config_id (indices shift). */
export interface SceneEditRegenWork {
  /** Cards with no audio yet (added by the plan). */
  generateNew: Set<string>;
  /** Cards whose whole variant set is rebuilt (new prompt, voice, line count). */
  force: Set<string>;
  /** Text-to-audio cards that get extra variants: config_id → copies to add. */
  addCopies: Map<string, number>;
  /** Speech cards with edited lines (same count): config_id → changed line indices. */
  inPlaceLines: Map<string, number[]>;
}

export interface SceneEditApplyContext {
  usageIndex: number;
  durationS: number;
  refMap: SceneEditRefMap;
  /** Ref → display name, for the chat labels. */
  names: Record<string, string>;
  regen: SceneEditRegenWork;
  /** Content or timing changed → re-orchestrate at the end of the turn. */
  needsOrchestrate: boolean;
  labels: string[];
  warnings: string[];
}

export function createApplyContext(
  usageIndex: number,
  durationS: number,
  refMap: SceneEditRefMap,
  names: Record<string, string>,
): SceneEditApplyContext {
  return {
    usageIndex,
    durationS,
    refMap: { cards: { ...refMap.cards }, objects: { ...refMap.objects } },
    names: { ...names },
    regen: { generateNew: new Set(), force: new Set(), addCopies: new Map(), inPlaceLines: new Map() },
    needsOrchestrate: false,
    labels: [],
    warnings: [],
  };
}

/** Live card index of a ref, or -1 (removed earlier in the plan / unknown). */
export function resolveRef(ctx: SceneEditApplyContext, ref: string): number {
  const configId = ctx.refMap.cards[ref];
  return configId ? cardIndexByConfigId(configId) : -1;
}

/** Live card indices of an op's targets; unresolved refs become warnings. */
export function resolveTargets(ctx: SceneEditApplyContext, op: SceneEditOp): number[] {
  const out: number[] = [];
  for (const ref of op.targets) {
    const index = resolveRef(ctx, ref);
    if (index >= 0) out.push(index);
    else ctx.warnings.push(`${op.op}: ${ctx.names[ref] ?? ref} is no longer in the scene`);
  }
  return out;
}

export function configAt(index: number): SoundGenerationConfig | undefined {
  return useSoundscapeStore.getState().soundConfigs[index];
}

/** Set several fields of a sound card (one store write per field — same as the card editors). */
export function patchConfig(index: number, patch: Partial<SoundGenerationConfig>): void {
  const { handleUpdateConfig } = useSoundscapeStore.getState();
  (Object.keys(patch) as (keyof SoundGenerationConfig)[]).forEach((key) => {
    handleUpdateConfig(index, key, patch[key]);
  });
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
