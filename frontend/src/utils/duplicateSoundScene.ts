import { apiService } from '@/services/api';
import {
  beginUndoInteraction,
  endUndoInteraction,
  notifyError,
  useAnalysisStore,
  useAudioControlsStore,
  useSoundscapeStore,
} from '@/store';
import type { AnalysisConfig } from '@/types/analysis';
import { newConfigId } from '@/utils/config-id';
import { getSceneTitle } from '@/utils/sceneWorkflow';
import { SIMPLE_MODE } from '@/utils/constants';

/**
 * Full copy of a sound scene (Simple mode "Duplicate"): the usage card, every
 * sound card under it, their generated events (same audio files and positions)
 * and per-sound DAW edits. The copy is inserted right after its source.
 *
 * The copy never shares an orchestration with its source: a scenario's backend
 * file is cloned under a new `scenarioId`, and a fresh `orchestrateId` keeps
 * the bake's `orchestrateId::entryId` keys apart. All writes land as ONE undo
 * step (the scenario clone is awaited first, outside the click's interaction).
 *
 * Returns the copy's usage index, or null when nothing was copied.
 *
 * Usage:
 * ```ts
 * const copyIndex = await duplicateSoundScene(scene.usageIndex);
 * if (copyIndex !== null) setPanel({ kind: 'scene', usageIndex: copyIndex });
 * ```
 */
export async function duplicateSoundScene(usageIndex: number): Promise<number | null> {
  const source = useAnalysisStore.getState().analysisConfigs[usageIndex];
  if (!source) return null;

  let scenarioId: string | undefined;
  if (source.type === 'scenario' && source.scenarioId) {
    try {
      scenarioId = (await apiService.duplicateScenario(source.scenarioId)).scenario_id;
    } catch (err) {
      notifyError(`${SIMPLE_MODE.DUPLICATE_SCENE_ERROR}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
  // The scene may have been removed / moved while the clone was awaited.
  if (useAnalysisStore.getState().analysisConfigs[usageIndex] !== source) return null;

  const orchestrateId = source.type === 'scenario' && source.orchestrateId ? newConfigId() : undefined;
  const overrides = {
    display_name: `${getSceneTitle(source, SIMPLE_MODE.SCENE_FALLBACK_TITLE)}${SIMPLE_MODE.DUPLICATE_SCENE_SUFFIX}`,
    ...(scenarioId ? { scenarioId } : {}),
    ...(orchestrateId ? { orchestrateId } : {}),
  } as Partial<AnalysisConfig>;
  const copyIndex = usageIndex + 1;

  beginUndoInteraction();
  try {
    // `toInsertion` is a gap index counted with the source lifted out (Ctrl+drag
    // semantics): `usageIndex + 2` lands the copy right AFTER the source, so the
    // source keeps its index and its sounds stay parented to it.
    useAnalysisStore.getState().duplicateConfigAt(usageIndex, usageIndex + 2, { keepResults: true, overrides });
    const idMap = useSoundscapeStore.getState().duplicateSceneSounds(usageIndex, copyIndex, {
      scenarioId,
      // Sounds orchestrated before the card stored an id still get their own.
      orchestrateId: orchestrateId ?? newConfigId(),
    });
    const audio = useAudioControlsStore.getState();
    audio.copySoundState(idMap);

    // Re-sync and re-bake so the copy's tracks get their own schedule.
    const { soundConfigs, generatedSounds } = useSoundscapeStore.getState();
    audio.syncSoundConfigs(soundConfigs);
    audio.syncGeneratedSounds(generatedSounds);
    if (soundConfigs.some((c) => c.orchestrateMeta)) {
      audio.setOrchestrateIterationLinks(soundConfigs);
      audio.bakeOrchestrateSchedule();
    }
  } finally {
    endUndoInteraction();
  }
  return copyIndex;
}
