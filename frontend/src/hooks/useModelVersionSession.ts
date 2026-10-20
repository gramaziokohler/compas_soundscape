'use client';

import { useCallback, useEffect, useRef } from 'react';
import { apiService } from '@/services/api';
import { useUIStore, useModelVersionStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { MODEL_VERSION_WATCH, SANDBOX_MODEL_ID } from '@/utils/constants';

export interface ModelVersionSession {
  /** True while a newer version than the loaded one exists (Refresh-scene warning). */
  hasUpdate: boolean;
  /** Load the latest version in place. */
  switchToLatest: () => void;
}

/**
 * Keeps the model-version store in sync with the open model.
 *
 *  - resets the store when another model opens (or none);
 *  - reports each version the viewer loads, which raises the "vN was loaded"
 *    banner when it differs from the last session / previous version;
 *  - polls the model's latest version (side-effect-free `/latest`) and raises
 *    the "vN was published" banner — never a blocking modal.
 */
export function useModelVersionSession(): ModelVersionSession {
  const globalSpeckleData = useUIStore((s) => s.globalSpeckleData);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const versions = useModelVersionStore((s) => s.versions);

  const modelId: string | null =
    globalSpeckleData?.model_id && globalSpeckleData.model_id !== SANDBOX_MODEL_ID
      ? globalSpeckleData.model_id
      : null;
  const modelName = globalSpeckleData?.display_name || null;

  // When another model opens, the engine store still holds the previous model's
  // loaded version until the viewer reloads — never attribute it to the new one.
  const staleVersionIdRef = useRef<string | null>(null);

  useEffect(() => {
    staleVersionIdRef.current = useSpeckleEngineStore.getState().loadedModelVersionId;
    useModelVersionStore.getState().resetForModel(modelId, modelName);
    // modelName only renames; the stale marker is about model changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  useEffect(() => {
    if (modelName) useModelVersionStore.getState().resetForModel(modelId, modelName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelName]);

  useEffect(() => {
    if (!modelId || !loadedVersionId) return;
    if (loadedVersionId === staleVersionIdRef.current) return;
    staleVersionIdRef.current = null;
    useModelVersionStore.getState().onVersionLoaded(loadedVersionId);
  }, [modelId, loadedVersionId]);

  useEffect(() => {
    if (!modelId || !loadedVersionId) return;
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const remote = await apiService.getModelLatestVersion(modelId);
        if (cancelled || !remote?.version_id || remote.version_id === loadedVersionId) return;
        const store = useModelVersionStore.getState();
        if (!store.versions.some((v) => v.id === remote.version_id)) await store.fetchVersions();
        if (cancelled) return;
        const latest = useModelVersionStore.getState().versions[0];
        const loaded = useModelVersionStore.getState().versions.find((v) => v.id === loadedVersionId);
        // Only a version genuinely newer than the loaded one is "published".
        if (latest && loaded && latest.number > loaded.number && !useModelVersionStore.getState().pinnedVersionId) {
          useModelVersionStore.getState().showPublished(latest.id);
        }
      } catch {
        /* transient network / Speckle error — try again next tick */
      }
    };
    void poll();
    const interval = setInterval(poll, MODEL_VERSION_WATCH.POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [modelId, loadedVersionId]);

  const latestId = versions[0]?.id ?? null;
  const hasUpdate = !!modelId && !!latestId && !!loadedVersionId && latestId !== loadedVersionId;

  const switchToLatest = useCallback(() => {
    const latest = useModelVersionStore.getState().versions[0];
    if (!latest) return;
    useModelVersionStore
      .getState()
      .switchToVersion(latest.id, useSpeckleEngineStore.getState().loadedModelVersionId);
  }, []);

  return { hasUpdate, switchToLatest };
}
