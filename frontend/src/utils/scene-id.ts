/**
 * Stable identity for sound scenes (usage cards).
 *
 * Scenes are addressed by array position everywhere else (`usageIndex`,
 * `parentUsageOriginalIndex`), which shifts on removal. Share links must survive
 * edits, so every scene card carries a `scene_id`. Ids are assigned lazily by
 * `withSceneIds` (installed on the analysis store) instead of at each creation
 * site, which also repairs duplicates produced by card duplication.
 */
import type { AnalysisConfig } from '@/types/analysis';
import { newConfigId } from '@/utils/config-id';

/** A usage card that can be a sound scene (mirrors `useSoundScenes`). */
export function isSceneConfig(config: AnalysisConfig): boolean {
  return (
    config.type === 'scenario' ||
    config.type === 'text' ||
    (config.type === 'freeform' && config.parentContextOriginalIndex !== undefined)
  );
}

/**
 * Give every scene card a unique `scene_id`. Returns the same array when
 * nothing changed so callers can skip the store write.
 */
export function withSceneIds(configs: AnalysisConfig[]): AnalysisConfig[] {
  const seen = new Set<string>();
  let changed = false;
  const next = configs.map((config) => {
    if (!isSceneConfig(config)) return config;
    const id = config.scene_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      return config;
    }
    changed = true;
    const fresh = newConfigId();
    seen.add(fresh);
    return { ...config, scene_id: fresh };
  });
  return changed ? next : configs;
}
