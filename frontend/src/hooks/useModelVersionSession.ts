'use client';

import { useCallback, useEffect, useRef } from 'react';
import { apiService } from '@/services/api';
import { useUIStore, useModelVersionStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { isShareViewActive } from '@/store/shareViewStore';
import { MODEL_VERSION_WATCH, SANDBOX_MODEL_ID } from '@/utils/constants';
import { waitForLoadableLatestVersion } from '@/utils/speckleLatestVersion';

export interface ModelVersionSession {
  /** True while a newer version than the loaded one exists (Refresh-scene warning). */
  hasUpdate: boolean;
  /** True while `reloadToLatest` waits for the new version to be loadable. */
  isPreparingLatest: boolean;
  /**
   * Wait until the model's latest version is loadable by the viewer, run
   * `beforeReload` (flush the autosave), then reload the page so everything
   * (viewer, world tree, version store) starts clean on the new version.
   * Throws when the version never becomes ready.
   */
  reloadToLatest: (beforeReload?: () => Promise<void>) => Promise<void>;
}

/**
 * Keeps the model-version store in sync with the open model.
 *
 *  - resets the store when another model opens (or none);
 *  - reports each version the viewer loads, which raises the "vN was loaded"
 *    banner when it differs from the last session / previous version;
 *  - polls the model's latest version (non-blocking `prepare-latest`, which also
 *    materializes a fresh upload in the background) and raises the "vN was
 *    published" banner once that version is loadable — never a blocking modal.
 */
export function useModelVersionSession(): ModelVersionSession {
  const globalSpeckleData = useUIStore((s) => s.globalSpeckleData);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const versions = useModelVersionStore((s) => s.versions);
  const isPreparingLatest = useModelVersionStore((s) => s.isPreparingLatest);

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
    // The public share view may only call /api/public/* (and never edits).
    if (!modelId || !loadedVersionId || isShareViewActive()) return;
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const remote = await apiService.prepareModelLatestVersion(modelId);
        // A fresh upload still materializing is not announced until it is loadable.
        if (cancelled || remote?.status !== 'ready' || !remote.version_id) return;
        if (remote.version_id === loadedVersionId) return;
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

  const reloadToLatest = useCallback(async (beforeReload?: () => Promise<void>) => {
    const store = useModelVersionStore.getState();
    const speckle = useUIStore.getState().globalSpeckleData;
    const targetModelId = store.modelId;
    if (!targetModelId || !speckle?.url || store.isPreparingLatest) return;

    const modelChanged = () => useModelVersionStore.getState().modelId !== targetModelId;
    store.setPreparingLatest(true);
    let reloading = false;
    try {
      const versionId = await waitForLoadableLatestVersion(
        targetModelId,
        speckle.url,
        speckle.auth_token,
        modelChanged,
      );
      // Another model was opened while waiting — nothing to reload into.
      if (!versionId || modelChanged()) return;
      console.log('[useModelVersionSession] latest version ready, reloading page:', versionId);
      await beforeReload?.();
      reloading = true;
      window.location.reload();
    } finally {
      // While the page unloads the button stays in its "preparing" state.
      if (!reloading) useModelVersionStore.getState().setPreparingLatest(false);
    }
  }, []);

  return { hasUpdate, isPreparingLatest, reloadToLatest };
}
