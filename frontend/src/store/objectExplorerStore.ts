/**
 * Object Explorer Store
 *
 * Tracks which Speckle objects are hidden or isolated so that the state is
 * accessible globally and can participate in undo/redo via zundo.
 *
 * The FilteringExtension is the authoritative renderer-side state; this store
 * mirrors it so other components can read without reaching into the viewer.
 *
 * Actions call the FilteringExtension then sync back into the store.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { FilteringExtension } from '@speckle/viewer';

// ─── Module-level viewer ref (not serializable → not in Zustand state) ────────
let _viewerRef: import('@speckle/viewer').Viewer | null = null;

// ─── State ────────────────────────────────────────────────────────────────────

export interface ObjectExplorerStoreState {
  hiddenObjectIds: Set<string>;
  isolatedObjectIds: Set<string>;

  /** Called by SpeckleScene / ObjectExplorer when viewer is available. */
  setViewer: (viewer: import('@speckle/viewer').Viewer | null) => void;

  /** Sync store state from the current extension state (call after direct ext calls). */
  syncFromExtension: () => void;

  // Actions that drive the FilteringExtension AND update store
  hideObjects: (objectIds: string[]) => void;
  showObjects: (objectIds: string[]) => void;
  isolateObjects: (objectIds: string[]) => void;
  unIsolateObjects: (objectIds: string[]) => void;
  clearFilters: () => void;

  // Read helpers
  areObjectsHidden: (objectIds: string[]) => boolean;
  areObjectsIsolated: (objectIds: string[]) => boolean;
}

// ─── Partialize for undo/redo ─────────────────────────────────────────────────

export const objectExplorerPartialize = (state: ObjectExplorerStoreState) => ({
  hiddenObjectIds: new Set(state.hiddenObjectIds),
  isolatedObjectIds: new Set(state.isolatedObjectIds),
});

// ─── Store ────────────────────────────────────────────────────────────────────

function getExtension() {
  if (!_viewerRef) return null;
  try {
    return _viewerRef.getExtension(FilteringExtension) ?? null;
  } catch {
    return null;
  }
}

export const useObjectExplorerStore = create<ObjectExplorerStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        hiddenObjectIds: new Set(),
        isolatedObjectIds: new Set(),

        setViewer: (viewer) => {
          _viewerRef = viewer;
        },

        syncFromExtension: () => {
          const ext = getExtension();
          if (!ext) return;
          const state = ext.filteringState;
          set(
            {
              hiddenObjectIds: new Set(state?.hiddenObjects ?? []),
              isolatedObjectIds: new Set(state?.isolatedObjects ?? []),
            },
            false,
            'objectExplorer/syncFromExtension',
          );
        },

        hideObjects: (objectIds) => {
          const ext = getExtension();
          if (!ext || objectIds.length === 0) return;
          ext.hideObjects(objectIds, undefined, true);
          _viewerRef?.requestRender();
          get().syncFromExtension();
        },

        showObjects: (objectIds) => {
          const ext = getExtension();
          if (!ext || objectIds.length === 0) return;
          ext.showObjects(objectIds, undefined, true);
          _viewerRef?.requestRender();
          get().syncFromExtension();
        },

        isolateObjects: (objectIds) => {
          const ext = getExtension();
          if (!ext || objectIds.length === 0) return;
          ext.isolateObjects(objectIds, undefined, true);
          _viewerRef?.requestRender();
          get().syncFromExtension();
        },

        unIsolateObjects: (objectIds) => {
          const ext = getExtension();
          if (!ext || objectIds.length === 0) return;
          ext.unIsolateObjects(objectIds, undefined, true);
          _viewerRef?.requestRender();
          get().syncFromExtension();
        },

        clearFilters: () => {
          const ext = getExtension();
          if (!ext) return;
          ext.resetFilters();
          _viewerRef?.requestRender();
          set(
            { hiddenObjectIds: new Set(), isolatedObjectIds: new Set() },
            false,
            'objectExplorer/clearFilters',
          );
        },

        areObjectsHidden: (objectIds) => {
          const { hiddenObjectIds } = get();
          return objectIds.every((id) => hiddenObjectIds.has(id));
        },

        areObjectsIsolated: (objectIds) => {
          const { isolatedObjectIds } = get();
          return objectIds.every((id) => isolatedObjectIds.has(id));
        },
      }),
      { name: 'objectExplorerStore' },
    ),
    {
      partialize: objectExplorerPartialize,
    },
  ),
);
