'use client';

import { useAnalysisStore, useUIStore } from '@/store';

/**
 * `scene_id` of the powered sound scene (the one shown in 3D + DAW), or null
 * when no scene is on.
 *
 * Usage:
 * ```tsx
 * const activeSceneId = useActiveSceneId();
 * ```
 */
export function useActiveSceneId(): string | null {
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);
  if (!isInSoundsStep || activeSoundParentIndex === null) return null;
  return analysisConfigs[activeSoundParentIndex]?.scene_id ?? null;
}
