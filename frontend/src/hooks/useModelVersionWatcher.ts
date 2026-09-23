'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '@/services/api';
import { useUIStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { MODEL_VERSION_WATCH, SANDBOX_MODEL_ID } from '@/utils/constants';
import type { SpeckleModelLatestVersion } from '@/types/speckle-models';

const DISMISSED_KEY = 'compas-dismissed-model-version';

function readDismissedVersionId(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissedVersionId(versionId: string | null): void {
  try {
    if (versionId) sessionStorage.setItem(DISMISSED_KEY, versionId);
    else sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    /* sessionStorage unavailable — dismissal will not survive a refresh */
  }
}

export interface ModelVersionWatcher {
  /** The newer version to offer in the modal (hidden after the user dismisses it). */
  pending: SpeckleModelLatestVersion | null;
  /** True while a newer version exists but is not loaded (drives the Refresh-scene warning). */
  hasUpdate: boolean;
  /** True while switching the viewer to the new version. */
  busy: boolean;
  /** Model display name, for the prompt copy. */
  modelName: string | null;
  /** Full page reload — bootstraps the model again and loads the latest version. */
  switchToLatest: () => void;
  /** Close the modal without switching (keeps `hasUpdate` true). */
  dismiss: () => void;
}

/**
 * Poll for a newer published version of the currently loaded Speckle model.
 *
 * Read-only (uses the side-effect-free `/latest` endpoint) and only active for a
 * real model (not the local sandbox / home stage). A newer version raises
 * `pending`; `switchToLatest()` reloads the page, whose bootstrap resolves and
 * loads the latest version. Dismissal is remembered per version for the session
 * while `hasUpdate` stays true so the scene control can show a warning.
 */
export function useModelVersionWatcher(): ModelVersionWatcher {
  const globalSpeckleData = useUIStore((s) => s.globalSpeckleData);
  const loadedModelVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const loadedModelVersionCreatedAt = useSpeckleEngineStore((s) => s.loadedModelVersionCreatedAt);

  const [latest, setLatest] = useState<SpeckleModelLatestVersion | null>(null);
  const [dismissedVersionId, setDismissedVersionId] = useState<string | null>(
    readDismissedVersionId,
  );
  const [busy, setBusy] = useState(false);

  const modelId: string | null =
    globalSpeckleData?.model_id && globalSpeckleData.model_id !== SANDBOX_MODEL_ID
      ? globalSpeckleData.model_id
      : null;
  const modelName: string | null =
    globalSpeckleData?.display_name || globalSpeckleData?.model_id || null;

  useEffect(() => {
    if (!modelId || !loadedModelVersionId) {
      setLatest(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const remote = await apiService.getModelLatestVersion(modelId);
        if (cancelled || !remote?.version_id) return;
        if (remote.version_id === loadedModelVersionId) {
          setLatest(null);
          return;
        }
        // `ensure-ready` on load re-materializes bundles / heals pre-fix copies,
        // producing a copy whose id differs from what `/latest` may briefly (or
        // persistently) still report. Compare server timestamps so only a version
        // genuinely published AFTER the loaded one counts as an update.
        const remoteNewer =
          !loadedModelVersionCreatedAt || !remote.created_at
            ? true
            : new Date(remote.created_at).getTime() >
              new Date(loadedModelVersionCreatedAt).getTime();
        setLatest(remoteNewer ? remote : null);
      } catch {
        /* transient network/Speckle error — try again next tick */
      }
    };

    void poll();
    const interval = setInterval(poll, MODEL_VERSION_WATCH.POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [modelId, loadedModelVersionId, loadedModelVersionCreatedAt]);

  const hasUpdate = latest !== null;
  const pending = latest && latest.version_id !== dismissedVersionId ? latest : null;

  const dismiss = useCallback(() => {
    if (latest?.version_id) {
      setDismissedVersionId(latest.version_id);
      writeDismissedVersionId(latest.version_id);
    }
  }, [latest]);

  const switchToLatest = useCallback(() => {
    if (!modelId) return;
    setBusy(true);
    writeDismissedVersionId(null);
    // Frame the newly loaded model's bounding box on the next bootstrap instead
    // of restoring the POV saved for the previous version. Module-level flags do
    // not survive a reload, so this is stashed in sessionStorage.
    try {
      sessionStorage.setItem(MODEL_VERSION_WATCH.FIT_CAMERA_ON_NEXT_LOAD_KEY, '1');
    } catch {
      /* sessionStorage unavailable — camera POV is restored instead */
    }
    // Full page reload: the ?model_id= bootstrap resolves and loads the latest
    // version, and the normal load-time linking/repositioning runs.
    window.location.reload();
  }, [modelId]);

  return { pending, hasUpdate, busy, modelName, switchToLatest, dismiss };
}
