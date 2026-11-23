/**
 * Space ops of the scene edit chat (move, directivity) and the placement rule
 * shared with added sounds: model objects ("O3") → their group centre, a sound
 * ref → next to that sound, else the explicit position.
 */

import { useSoundscapeStore } from '@/store';
import type { SceneEditOp } from '@/types/sceneEdit';
import type { SoundDirectivity } from '@/types/directivity';
import { SCENE_EDIT } from '@/utils/constants';
import { configAt, patchConfig, resolveRef, resolveTargets, type SceneEditApplyContext } from './applyContext';
import { cardEvents, round, type Vec3 } from './sceneCards';

const OMNI_PRESET = 'omni';
const DEG_TO_RAD = Math.PI / 180;

/** Current position of card `index` (card, first variant, or first linked object). */
export function cardPosition(index: number): Vec3 | null {
  const config = configAt(index);
  const pos = config?.position ?? cardEvents(index)[0]?.position ?? config?.entities?.[0]?.position;
  return pos && pos.length >= 3 ? [pos[0], pos[1], pos[2]] : null;
}

/** Where an op places a sound, or null when it gives no usable place. */
export function resolvePlacement(ctx: SceneEditApplyContext, op: SceneEditOp): Vec3 | null {
  const centers = op.anchor_objects.map((r) => ctx.refMap.objects[r]).filter((c): c is Vec3 => !!c);
  if (centers.length > 0) {
    return [0, 1, 2].map((a) => round(centers.reduce((s, c) => s + c[a], 0) / centers.length)) as Vec3;
  }
  if (op.near) {
    const nearIndex = resolveRef(ctx, op.near);
    const base = nearIndex >= 0 ? cardPosition(nearIndex) : null;
    if (base) return [round(base[0] + SCENE_EDIT.NEAR_OFFSET_M), base[1], base[2]];
  }
  if (op.position.length >= 3) return [op.position[0], op.position[1], op.position[2]];
  return null;
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
  const position = resolvePlacement(ctx, op);
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
