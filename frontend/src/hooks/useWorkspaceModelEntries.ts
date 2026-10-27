import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '@/services/api';
import { speckleModifiedTime } from '@/components/scene/modelBrowserShared';
import type { HomeProjectSummary } from '@/components/scene/HomeProjectCard';
import type { SpeckleModelDetail, SpeckleProjectModelsResponse } from '@/types/speckle-models';

/** One row of the merged list, keyed by its modified date for sorting. */
export type WorkspaceModelEntry =
  | { kind: 'home'; key: string; time: number; project: HomeProjectSummary }
  | { kind: 'speckle'; key: string; time: number; model: SpeckleModelDetail };

export interface UseWorkspaceModelEntriesResult {
  /** Home projects (when included) + loadable Speckle models, newest first. */
  entries: WorkspaceModelEntry[];
  /** Every Speckle model of the project, loadable or not. */
  models: SpeckleModelDetail[];
  projectId: string;
  authToken?: string;
  isLoading: boolean;
  error: string | null;
  refetchModels: () => Promise<void>;
  /** Drop a Home project from the list (after it was deleted on the backend). */
  removeHomeProject: (modelId: string) => void;
}

/**
 * Loads the workspace's saved Home (no-model) projects and the Speckle project's
 * models, merged into one list ordered by modified date (newest first). Speckle
 * models without a version are left out (they cannot be opened).
 *
 * Usage:
 * ```tsx
 * const { entries, projectId, authToken, isLoading } = useWorkspaceModelEntries(true);
 * // scene-send targets of a shared workspace: the caller's own workspace
 * const own = useWorkspaceModelEntries(true, true);
 * ```
 */
export function useWorkspaceModelEntries(includeHomeProjects: boolean, ownWorkspace = false): UseWorkspaceModelEntriesResult {
  const [models, setModels] = useState<SpeckleModelDetail[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [homeProjects, setHomeProjects] = useState<HomeProjectSummary[]>([]);

  useEffect(() => {
    if (!includeHomeProjects) return;
    let cancelled = false;
    apiService
      .listHomeProjects(ownWorkspace)
      .then((data) => { if (!cancelled) setHomeProjects(data.projects ?? []); })
      .catch(() => { if (!cancelled) setHomeProjects([]); });
    return () => { cancelled = true; };
  }, [includeHomeProjects, ownWorkspace]);

  const refetchModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data: SpeckleProjectModelsResponse = await apiService.getSpeckleModels(ownWorkspace);
      setModels(data.models);
      setProjectId(data.project_id);
      setAuthToken(data.auth_token ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setIsLoading(false);
    }
  }, [ownWorkspace]);

  useEffect(() => {
    void refetchModels();
  }, [refetchModels]);

  const removeHomeProject = useCallback((modelId: string) => {
    setHomeProjects((prev) => prev.filter((p) => p.model_id !== modelId));
  }, []);

  const entries = useMemo<WorkspaceModelEntry[]>(() => {
    const home: WorkspaceModelEntry[] = includeHomeProjects
      ? homeProjects.map((p) => ({
          kind: 'home',
          key: `home:${p.model_id}`,
          time: new Date(p.saved_at).getTime(),
          project: p,
        }))
      : [];
    const speckle: WorkspaceModelEntry[] = models
      .filter((m) => m.latest_version)
      .map((m) => ({ kind: 'speckle', key: `speckle:${m.id}`, time: speckleModifiedTime(m), model: m }));
    return [...home, ...speckle].sort((a, b) => b.time - a.time);
  }, [homeProjects, models, includeHomeProjects]);

  return { entries, models, projectId, authToken, isLoading, error, refetchModels, removeHomeProject };
}
