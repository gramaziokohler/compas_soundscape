import { useMemo } from 'react';
import { useAnalysisStore, useSoundscapeStore, useSceneWorkflowStore } from '@/store';
import type { SoundScene } from '@/types/sceneWorkflow';
import { getSceneFullTitle, getSceneSoundIndices, getSceneTitle, isSoundConfigGenerated } from '@/utils/sceneWorkflow';

/**
 * Sound scenes shown as bubbles in Simple mode.
 *
 * A scene is a usage card (scenario / text / parented freeform) that is either a
 * scenario card or already has sound children. Unparented sounds are not a scene.
 *
 * Usage:
 * ```tsx
 * const scenes = useSoundScenes();
 * scenes.map((s) => <Bubble key={s.usageIndex} label={s.title} />);
 * ```
 */
export function useSoundScenes(): SoundScene[] {
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const runs = useSceneWorkflowStore((s) => s.runs);

  return useMemo(() => {
    const scenes: SoundScene[] = [];
    analysisConfigs.forEach((config, usageIndex) => {
      const parent = config.parentContextOriginalIndex;
      const isUsage =
        config.type === 'scenario' ||
        config.type === 'text' ||
        (config.type === 'freeform' && parent !== undefined);
      if (!isUsage) return;

      const indices = getSceneSoundIndices(soundConfigs, usageIndex);
      const isScenario = config.type === 'scenario';
      if (!isScenario && indices.length === 0 && !(usageIndex in runs)) return;

      const fallback = `Scene ${scenes.length + 1}`;
      scenes.push({
        usageIndex,
        contextIndex: parent ?? null,
        title: getSceneTitle(config, fallback),
        fullTitle: getSceneFullTitle(config, fallback),
        isScenario,
        soundCount: indices.length,
        generatedCount: indices.filter((i) => isSoundConfigGenerated(soundConfigs, generatedSounds, i)).length,
      });
    });
    return scenes;
  }, [analysisConfigs, soundConfigs, generatedSounds, runs]);
}
