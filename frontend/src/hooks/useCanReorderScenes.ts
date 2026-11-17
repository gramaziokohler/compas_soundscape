import { useAnalysisStore, useSceneWorkflowStore } from '@/store';

/**
 * useCanReorderScenes Hook
 *
 * Whether scene (usage card) order may change right now. Reordering remaps every
 * live index link, but in-flight LLM jobs are also recorded for refresh recovery
 * with a raw card index (lib/job-tracker.ts), which no remap reaches. So scenes
 * stay put while a scene pipeline runs or any card is analyzing / uploading /
 * rehydrating audio — the column becomes draggable again once that work ends.
 *
 * Usage:
 * ```tsx
 * const canReorder = useCanReorderScenes();
 * <BubbleScrollColumn onReorder={canReorder ? handleReorder : undefined} … />
 * ```
 */
export function useCanReorderScenes(): boolean {
  const isRunning = useSceneWorkflowStore((s) => Object.values(s.runs).some((run) => run.status === 'running'));
  const isBusy = useAnalysisStore((s) =>
    s.analyzingConfigIndices.size > 0 || s.uploadingConfigs.size > 0 || s.rehydratingAudioConfigs.size > 0,
  );
  return !isRunning && !isBusy;
}
