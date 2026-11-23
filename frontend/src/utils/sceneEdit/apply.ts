/**
 * Apply a scene-edit plan to the stores as ONE undo step. Audio work the ops
 * queue (ctx.regen) and the re-orchestration run afterwards (sceneEditStore).
 */

import {
  beginUndoInteraction,
  endUndoInteraction,
  useAnalysisStore,
  useAudioControlsStore,
  useSoundscapeStore,
} from '@/store';
import type { SceneEditOp, SceneEditRefMap } from '@/types/sceneEdit';
import { applyContentOp } from './applyContent';
import { createApplyContext, type SceneEditApplyContext } from './applyContext';
import { applyMixOp } from './applyMix';
import { applySpaceOp } from './applySpace';
import { applyTimingOp } from './applyTiming';
import { sceneEditOpLabel } from './opLabels';

function renameScene(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  if (!op.title) return false;
  useAnalysisStore.getState().handleUpdateConfig(ctx.usageIndex, { display_name: op.title });
  return true;
}

function applyOp(ctx: SceneEditApplyContext, op: SceneEditOp): boolean {
  switch (op.op) {
    case 'set_level':
    case 'mute':
    case 'unmute':
    case 'solo':
    case 'unsolo':
    case 'set_loopable':
    case 'trim':
      return applyMixOp(ctx, op);
    case 'set_times':
    case 'shift':
    case 'set_density':
    case 'remove_occurrences':
    case 'set_scene_duration':
      return applyTimingOp(ctx, op);
    case 'move':
    case 'set_directivity':
      return applySpaceOp(ctx, op);
    case 'rename_scene':
      return renameScene(ctx, op);
    default:
      return applyContentOp(ctx, op);
  }
}

/** Re-derive the DAW schedule from the edited cards (same sequence as card removal). */
function resyncTimeline(): void {
  const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
  const audio = useAudioControlsStore.getState();
  audio.syncSoundConfigs(soundConfigs);
  audio.syncGeneratedSounds(generatedSounds);
  audio.setOrchestrateIterationLinks(soundConfigs, { preserveExisting: true });
  audio.bakeOrchestrateSchedule();
}

/**
 * Apply `ops` to scene `usageIndex`. `refMap` / `names` come from the snapshot
 * the plan was made from; `durationS` is the scene length.
 */
export function applySceneEditOps(
  usageIndex: number,
  ops: SceneEditOp[],
  refMap: SceneEditRefMap,
  names: Record<string, string>,
  durationS: number,
): SceneEditApplyContext {
  const ctx = createApplyContext(usageIndex, durationS, refMap, names);
  beginUndoInteraction();
  try {
    for (const op of ops) {
      try {
        if (applyOp(ctx, op)) ctx.labels.push(sceneEditOpLabel(op, ctx.names));
      } catch (err) {
        console.warn('[sceneEdit] op failed', op, err);
        ctx.warnings.push(`${op.op} failed`);
      }
    }
    resyncTimeline();
  } finally {
    endUndoInteraction();
  }
  return ctx;
}
