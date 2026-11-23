/**
 * Mix ops of the scene edit chat: level, mute / solo, loop, trim. Instant (no
 * regeneration) and stored in audioControlsStore, so the user's override wins
 * over the orchestrator's levels.
 */

import { useAudioControlsStore } from '@/store';
import type { SceneEditOp } from '@/types/sceneEdit';
import { DBFS_MAX, DBFS_MIN } from '@/utils/constants';
import { clamp, configAt, patchConfig, resolveTargets, type SceneEditApplyContext } from './applyContext';
import { cardEvents } from './sceneCards';
import { cardLevelDb } from './snapshot';

function setLevel(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const indices = resolveTargets(ctx, op);
  const audio = useAudioControlsStore.getState();
  indices.forEach((index) => {
    const config = configAt(index);
    if (!config) return;
    const events = cardEvents(index);
    const current = cardLevelDb(config, events[0]?.id ?? null, events[0]?.volume_dbfs);
    const next = clamp(op.db ?? current + (op.delta_db ?? 0), DBFS_MIN, DBFS_MAX);
    if (events.length === 0) {
      patchConfig(index, { dbfs: next });
      return;
    }
    // Every variant: the timeline may play any copy of the track.
    events.forEach((e) => audio.handleVolumeChange(e.id, next));
  });
  return indices.length > 0;
}

function setMuteSolo(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const indices = resolveTargets(ctx, op);
  const { mutedSounds, soloedSounds, restoreMuteSolo } = useAudioControlsStore.getState();
  const muted = new Set(mutedSounds);
  const soloed = new Set(soloedSounds);
  indices.forEach((index) => {
    cardEvents(index).forEach(({ id }) => {
      if (op.op === 'mute') { muted.add(id); soloed.delete(id); }
      if (op.op === 'unmute') muted.delete(id);
      if (op.op === 'solo') { soloed.add(id); muted.delete(id); }
      if (op.op === 'unsolo') soloed.delete(id);
    });
  });
  restoreMuteSolo([...muted], [...soloed]);
  return indices.length > 0;
}

function setLoopable(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const indices = resolveTargets(ctx, op);
  const audio = useAudioControlsStore.getState();
  let applied = false;
  indices.forEach((index) => {
    const primary = cardEvents(index)[0];
    if (!primary) {
      ctx.warnings.push(`${ctx.names[op.targets[0]] ?? 'A sound'} has no audio to loop yet`);
      return;
    }
    const wanted = op.on !== false;
    if ((audio.soundLoopable[primary.id] ?? false) !== wanted) {
      // Loop detection runs server-side; the toggle finishes on its own.
      void audio.toggleSoundLoopable(primary.id, primary.url);
    }
    applied = true;
  });
  return applied;
}

function trim(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  const indices = resolveTargets(ctx, op);
  const audio = useAudioControlsStore.getState();
  let applied = false;
  indices.forEach((index) => {
    const primary = cardEvents(index)[0];
    if (!primary || op.start === null || op.end === null) return;
    audio.setSoundTrim(primary.id, { start: op.start, end: op.end });
    applied = true;
  });
  return applied;
}

/** Apply a mix op; returns false when nothing changed. */
export function applyMixOp(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  switch (op.op) {
    case 'set_level': return setLevel(ctx, op);
    case 'mute':
    case 'unmute':
    case 'solo':
    case 'unsolo': return setMuteSolo(ctx, op);
    case 'set_loopable': return setLoopable(ctx, op);
    case 'trim': return trim(ctx, op);
    default: return false;
  }
}
