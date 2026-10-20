/**
 * Model version store — which version of the open Speckle model is loaded, its
 * version history, and what a version change impacts.
 *
 * Navigation / derived state only: NOT an undoable store. Switching versions is
 * like opening a project (not an edit), and impact reports are recomputed from
 * the backend. Edits the user makes from the review panel (material assignment,
 * re-linking a sound) go through the regular undoable stores.
 *
 * Loading rule: the viewer always follows the LATEST version; the user may pin an
 * older version for the session (`pinnedVersionId`). A refresh loads the latest
 * again, and the open-time banner compares it with the version the soundscape
 * was last saved on (`sessionBaseVersionId`).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { MODEL_VERSION } from '@/utils/constants';
import type { SpeckleModelVersion } from '@/types/speckle-models';
import type {
  ModelVersionImpactReport,
  ModelVersionImpactRequest,
  ModelVersionTolerance,
} from '@/types/modelVersionImpact';

export type ImpactStatus = 'loading' | 'ready' | 'error';

export interface ImpactEntry {
  status: ImpactStatus;
  report: ModelVersionImpactReport | null;
  error: string | null;
}

/** A linked sound whose object moved or disappeared when geometry (re)loaded. */
export interface LinkReconciliationItem {
  configId: string;
  configIndex: number;
  soundName: string;
  objectName: string;
  /** Distance the sound followed its object (moved), absent when lost. */
  movedM?: number;
}

export interface LinkReconciliationReport {
  /** Version the reconciliation ran for. */
  versionId: string | null;
  followed: LinkReconciliationItem[];
  lost: LinkReconciliationItem[];
}

/** Banner over the viewer: a version was loaded, or a newer one was published. */
export type ModelVersionBanner =
  /** `session` = compared with the version the soundscape was last saved on; `switch` = in-session change. */
  | { kind: 'loaded'; fromVersionId: string; toVersionId: string; reason: 'session' | 'switch' }
  | { kind: 'published'; versionId: string };

export interface ModelVersionStoreState {
  modelId: string | null;
  /** Speckle model name (fallback label when no file name is known). */
  modelName: string | null;
  versions: SpeckleModelVersion[];
  versionsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Older version the user chose to view (null = follow the latest). */
  pinnedVersionId: string | null;
  /** Bumped to make the viewer re-load in place (e.g. a newer latest). */
  viewerReloadNonce: number;
  /** Version the soundscape was last saved on (open-time comparison base). */
  sessionBaseVersionId: string | null;
  /** Version loaded before the current one (set by an in-session switch). */
  previousVersionId: string | null;
  banner: ModelVersionBanner | null;
  /** Banner identity the user closed (kind + versions). */
  dismissedBannerKey: string | null;
  /** Comparison shown in the review panel (null = closed). */
  review: { fromVersionId: string; toVersionId: string } | null;
  tolerance: ModelVersionTolerance;
  /** Impact reports keyed by `impactKey(request)`. */
  impacts: Record<string, ImpactEntry>;
  linkReconciliation: LinkReconciliationReport | null;
  /** Review rows the user acknowledged ("Keep free"), by row id. */
  acknowledgedRows: string[];
  /** Simulation config ids queued for a re-run (consumed by AcousticsSection). */
  rerunQueue: string[];
  /** Simulation card to expand (consumed by AcousticsSection); `seq` re-triggers. */
  revealSimulation: { configId: string | null; seq: number } | null;
  isUploadingVersion: boolean;

  /** Reset for a newly opened model (or none). */
  resetForModel: (modelId: string | null, modelName?: string | null) => void;
  fetchVersions: () => Promise<void>;
  /** Version the restored soundscape was saved on (resets the store first for another model). */
  setSessionBaseVersion: (modelId: string, versionId: string | null) => void;
  /** Load a version in place (latest → follow latest). */
  switchToVersion: (versionId: string, currentVersionId: string | null) => void;
  /** Called once the viewer reports the version it loaded. */
  onVersionLoaded: (versionId: string | null) => void;
  showPublished: (versionId: string) => void;
  dismissBanner: () => void;
  openReview: (fromVersionId: string, toVersionId: string) => void;
  closeReview: () => void;
  setTolerance: (patch: Partial<ModelVersionTolerance>) => void;
  ensureImpact: (request: ModelVersionImpactRequest) => string;
  setLinkReconciliation: (report: LinkReconciliationReport) => void;
  acknowledgeRow: (rowId: string) => void;
  requestRerun: (configIds: string[]) => void;
  consumeRerunQueue: () => string[];
  /** Expand a simulation card (null = the most relevant one) so its materials are editable. */
  requestRevealSimulation: (configId: string | null) => void;
  setUploadingVersion: (uploading: boolean) => void;
}

/** Stable key of an impact request (versions + tolerance + region + points). */
export function impactKey(request: ModelVersionImpactRequest): string {
  return JSON.stringify([
    request.from_version_id,
    request.to_version_id,
    request.tolerance,
    request.region
      ? [request.region.whole_model, [...request.region.ids].sort(), [...request.region.layers].sort()]
      : null,
    request.points.map((p) => [p.id, p.position]),
  ]);
}

// ─── Versions this browser already opened (per model) ─────────────────────────
// Per-viewer convenience in localStorage: the "vN was loaded" banner shows only
// the first time a version is opened. Every access is guarded (private mode,
// blocked storage) — without storage the banner simply shows again.

function readSeenVersions(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(MODEL_VERSION.SEEN_VERSIONS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** Record that `versionId` was opened; returns true when it is the first time. */
function markVersionSeen(modelId: string, versionId: string): boolean {
  const seen = readSeenVersions();
  const list = Array.isArray(seen[modelId]) ? seen[modelId] : [];
  if (list.includes(versionId)) return false;
  try {
    seen[modelId] = [...list, versionId].slice(-MODEL_VERSION.SEEN_VERSIONS_PER_MODEL);
    localStorage.setItem(MODEL_VERSION.SEEN_VERSIONS_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    /* storage unavailable — treated as first time */
  }
  return true;
}

export function bannerKey(banner: ModelVersionBanner): string {
  return banner.kind === 'loaded'
    ? `loaded:${banner.fromVersionId}:${banner.toVersionId}`
    : `published:${banner.versionId}`;
}

const initialModelState = {
  modelId: null as string | null,
  modelName: null as string | null,
  versions: [] as SpeckleModelVersion[],
  versionsStatus: 'idle' as const,
  pinnedVersionId: null as string | null,
  sessionBaseVersionId: null as string | null,
  previousVersionId: null as string | null,
  banner: null as ModelVersionBanner | null,
  dismissedBannerKey: null as string | null,
  review: null as { fromVersionId: string; toVersionId: string } | null,
  impacts: {} as Record<string, ImpactEntry>,
  linkReconciliation: null as LinkReconciliationReport | null,
  acknowledgedRows: [] as string[],
  rerunQueue: [] as string[],
  revealSimulation: null as { configId: string | null; seq: number } | null,
  isUploadingVersion: false,
};

export const useModelVersionStore = create<ModelVersionStoreState>()(
  devtools(
    (set, get) => ({
      ...initialModelState,
      viewerReloadNonce: 0,
      tolerance: { ...MODEL_VERSION.DEFAULT_TOLERANCE },

      resetForModel: (modelId, modelName = null) => {
        if (get().modelId === modelId) {
          if (modelName && modelName !== get().modelName) set({ modelName }, false, 'modelVersion/rename');
          return;
        }
        set({ ...initialModelState, modelId, modelName }, false, 'modelVersion/resetForModel');
        if (modelId) void get().fetchVersions();
      },

      fetchVersions: async () => {
        const { modelId } = get();
        if (!modelId) return;
        set({ versionsStatus: 'loading' }, false, 'modelVersion/fetchVersions');
        try {
          const res = await apiService.getModelVersions(modelId);
          if (get().modelId !== modelId) return;
          set(
            { versions: res.versions, modelName: get().modelName || res.model_name, versionsStatus: 'ready' },
            false,
            'modelVersion/versionsLoaded',
          );
        } catch {
          if (get().modelId === modelId) set({ versionsStatus: 'error' }, false, 'modelVersion/versionsError');
        }
      },

      setSessionBaseVersion: (modelId, versionId) => {
        // The restore can run before the session hook resets the store for this model.
        get().resetForModel(modelId);
        set({ sessionBaseVersionId: versionId || null }, false, 'modelVersion/setSessionBase');
      },

      switchToVersion: (versionId, currentVersionId) => {
        const latest = get().versions[0];
        const followLatest = !latest || latest.id === versionId;
        const nextPinned = followLatest ? null : versionId;
        set(
          (s) => ({
            pinnedVersionId: nextPinned,
            previousVersionId: currentVersionId,
            // Same viewer URL (latest → newer latest): force an in-place reload.
            viewerReloadNonce: s.pinnedVersionId === nextPinned ? s.viewerReloadNonce + 1 : s.viewerReloadNonce,
            banner: null,
            review: null,
          }),
          false,
          'modelVersion/switchToVersion',
        );
      },

      onVersionLoaded: (versionId) => {
        if (!versionId) return;
        const { previousVersionId, sessionBaseVersionId, versions, modelId } = get();
        // The banner introduces a version once — reopening a version already seen
        // in this browser (refresh, going back and forth) stays quiet.
        const firstTime = modelId ? markVersionSeen(modelId, versionId) : true;
        // In-session switch first; otherwise compare with the last saved session.
        const from = previousVersionId ?? sessionBaseVersionId;
        const known = versions.some((v) => v.id === versionId);
        if (!known) void get().fetchVersions(); // healed copy / brand-new upload
        if (!from || from === versionId || !firstTime) {
          set({ banner: null, sessionBaseVersionId: versionId, previousVersionId: null }, false, 'modelVersion/loadedQuiet');
          return;
        }
        const banner: ModelVersionBanner = {
          kind: 'loaded',
          fromVersionId: from,
          toVersionId: versionId,
          reason: previousVersionId ? 'switch' : 'session',
        };
        set(
          {
            banner: get().dismissedBannerKey === bannerKey(banner) ? null : banner,
            // The comparison base moves on: a later refresh compares with this version.
            sessionBaseVersionId: versionId,
            previousVersionId: null,
          },
          false,
          'modelVersion/loadedOther',
        );
      },

      showPublished: (versionId) => {
        const banner: ModelVersionBanner = { kind: 'published', versionId };
        if (get().dismissedBannerKey === bannerKey(banner)) return;
        // Never replace an open "loaded" banner the user has not dealt with.
        if (get().banner?.kind === 'loaded') return;
        set({ banner }, false, 'modelVersion/showPublished');
      },

      dismissBanner: () => {
        const { banner } = get();
        set({ banner: null, dismissedBannerKey: banner ? bannerKey(banner) : null }, false, 'modelVersion/dismissBanner');
      },

      openReview: (fromVersionId, toVersionId) =>
        set({ review: { fromVersionId, toVersionId } }, false, 'modelVersion/openReview'),

      closeReview: () => set({ review: null }, false, 'modelVersion/closeReview'),

      setTolerance: (patch) =>
        set((s) => ({ tolerance: { ...s.tolerance, ...patch } }), false, 'modelVersion/setTolerance'),

      ensureImpact: (request) => {
        const key = impactKey(request);
        const existing = get().impacts[key];
        if (existing && existing.status !== 'error') return key;
        set(
          (s) => ({ impacts: { ...s.impacts, [key]: { status: 'loading', report: null, error: null } } }),
          false,
          'modelVersion/impactStart',
        );
        apiService
          .getModelVersionImpact(request)
          .then((report) => {
            set(
              (s) => ({ impacts: { ...s.impacts, [key]: { status: 'ready', report, error: null } } }),
              false,
              'modelVersion/impactReady',
            );
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Could not compare the versions';
            set(
              (s) => ({ impacts: { ...s.impacts, [key]: { status: 'error', report: null, error: message } } }),
              false,
              'modelVersion/impactError',
            );
          });
        return key;
      },

      setLinkReconciliation: (report) =>
        set({ linkReconciliation: report, acknowledgedRows: [] }, false, 'modelVersion/linkReconciliation'),

      acknowledgeRow: (rowId) =>
        set((s) => ({ acknowledgedRows: [...s.acknowledgedRows, rowId] }), false, 'modelVersion/acknowledgeRow'),

      requestRerun: (configIds) =>
        set((s) => ({ rerunQueue: [...s.rerunQueue, ...configIds] }), false, 'modelVersion/requestRerun'),

      consumeRerunQueue: () => {
        const queue = get().rerunQueue;
        if (queue.length > 0) set({ rerunQueue: [] }, false, 'modelVersion/consumeRerunQueue');
        return queue;
      },

      requestRevealSimulation: (configId) =>
        set(
          (s) => ({ revealSimulation: { configId, seq: (s.revealSimulation?.seq ?? 0) + 1 } }),
          false,
          'modelVersion/requestRevealSimulation',
        ),

      setUploadingVersion: (uploading) =>
        set({ isUploadingVersion: uploading }, false, 'modelVersion/setUploading'),
    }),
    { name: 'modelVersionStore' },
  ),
);

// ─── Selectors / helpers ───────────────────────────────────────────────────────

/** Version entry by id (null when not in the fetched history). */
export function findModelVersion(versions: SpeckleModelVersion[], id: string | null | undefined): SpeckleModelVersion | null {
  if (!id) return null;
  return versions.find((v) => v.id === id) ?? null;
}

/** "v12", or a neutral label when the version is not in the history. */
export function versionLabel(versions: SpeckleModelVersion[], id: string | null | undefined): string {
  const v = findModelVersion(versions, id);
  return v ? `v${v.number}` : 'an earlier version';
}
