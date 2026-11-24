/**
 * Space ops of the scene edit chat (move, directivity). Placement is the agent's
 * own [x, y, z] (backend-clamped inside the room); there is no fallback place.
 */

import { useSoundscapeStore } from '@/store';
import type { SceneEditOp } from '@/types/sceneEdit';
import type { SoundDirectivity } from '@/types/directivity';
import { configAt, patchConfig, resolveTargets, type SceneEditApplyContext } from './applyContext';
import { cardEvents, type Vec3 } from './sceneCards';

const OMNI_PRESET = 'omni';
const DEG_TO_RAD = Math.PI / 180;

/** Where an op places a sound, or null when it gives no usable place. */
export function resolvePlacement(op: SceneEditOp): Vec3 | null {
  return op.position.length >= 3 ? [op.position[0], op.position[1], op.position[2]] : null;
}

/** Move card `index` to `position`, dropping its object links (the sound now sits at a point). */
export function placeCard(index: number, position: Vec3): void {
  const store = useSoundscapeStore.getState();
  const config = configAt(index);
  if (!config) return;
  if (config.entities?.length) store.handleDetachSoundFromEntity(index);
  const patch: Parameters<typeof patchConfig>[1] = { position };
  if (config.scenarioSource) patch.scenarioSource = { ...config.scenarioSource, position, objectsInvolved: [] };
  patchConfig(index, patch);
  // Speech lines are separate events (one prompt_index each): move every variant.
  cardEvents(index).forEach((e) => useSoundscapeStore.getState().updateSoundPosition(e.id, position));
}

function move(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const position = resolvePlacement(op);
  if (!position) {
    ctx.warnings.push('move: no place to move to');
    return false;
  }
  const indices = resolveTargets(ctx, op);
  indices.forEach((index) => placeCard(index, position));
  return indices.length > 0;
}

function setDirectivity(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const directivity: SoundDirectivity | undefined = op.preset === OMNI_PRESET
    ? undefined
    : { id: op.preset, yaw: (op.yaw_deg ?? 0) * DEG_TO_RAD, pitch: 0, roll: 0 };
  const indices = resolveTargets(ctx, op);
  indices.forEach((index) => {
    const primary = cardEvents(index)[0];
    if (primary) useSoundscapeStore.getState().updateSoundDirectivity(primary.id, directivity);
    else patchConfig(index, { directivity });
  });
  return indices.length > 0;
}

/** Apply a space op; returns false when nothing changed. */
export function applySpaceOp(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  if (op.op === 'move') return move(ctx, op);
  if (op.op === 'set_directivity') return setDirectivity(ctx, op);
  return false;
}
