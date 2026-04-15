/**
 * Speckle Store
 *
 * Replaces SpeckleViewerContext + SpeckleSelectionModeContext.
 *
 * The Viewer instance itself cannot live in Zustand state (non-serializable),
 * so it is held in a module-level ref. All other state (links, selection,
 * entity, mode) is Zustand state.
 *
 * applyFilterColors reads from module-level refs for perf (same pattern as
 * the original context). Color re-application is debounced 50 ms to batch
 * rapid updates — matching original context behaviour.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { FilteringExtension, type Viewer } from '@speckle/viewer';
import { SPECKLE_FILTER_COLORS } from '@/utils/constants';
import type React from 'react';

// ─── Types (re-exported for consumers) ───────────────────────────────────────

export interface SelectedEntityInfo {
  objectId: string;
  objectName: string;
  objectType: string;
  parentName?: string;
  receiverData?: { position: [number, number, number] };
  soundData?: { promptIndex: number };
}

export type ViewMode = 'acoustic' | 'default' | 'dark';

export interface ColorGroup {
  objectIds: string[];
  color: string;
}

// ─── Module-level refs (non-Zustand, non-serializable) ───────────────────────

/** The live Speckle viewer instance — set via setViewer() */
let _viewerRef: Viewer | null = null;

/** Same-render access to objectSoundLinks without stale closure issues */
let _objectSoundLinksRef: Map<string, number> = new Map();
let _generatedSoundObjectIdsRef: Set<string> = new Set();
let _diverseSelectedObjectIdsRef: Set<string> = new Set();
let _materialColorsRef: ColorGroup[] = [];
let _viewModeRef: ViewMode = 'default';

/** Model fileName from SpeckleViewerContext */
let _modelFileNameRef: string | null = null;

/** worldTreeVersion held as a ref so we can increment without re-read */
let _worldTreeVersion = 0;

// Debounce handle for applyFilterColors
let _applyColorsTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Store state/actions interface ───────────────────────────────────────────

export interface SpeckleStoreState {
  // ── From SpeckleViewerContext ──────────────────────────────────────────────
  /** Access via getViewerRef() to avoid storing non-serializable value */
  modelFileName: string | null;
  worldTreeVersion: number;

  getViewerRef: () => Viewer | null;
  setViewer: (viewer: Viewer | null) => void;
  setModelFileName: (name: string | null) => void;
  incrementWorldTreeVersion: () => void;

  // ── From SpeckleSelectionModeContext ──────────────────────────────────────
  /** objectId → soundTabIndex */
  objectSoundLinks: Map<string, number>;
  generatedSoundObjectIds: Set<string>;
  diverseSelectedObjectIds: Set<string>;
  linkVersion: number;
  selectedEntity: SelectedEntityInfo | null;
  /** All currently Speckle-selected object IDs (supports multi-select via shift-click) */
  selectedObjectIds: string[];
  filteringEnabled: boolean;
  viewMode: ViewMode;

  // Derived
  linkedObjectIds: Set<string>;

  // Actions — link management
  linkObjectToSound: (objectId: string, soundTabIndex: number, hasGeneratedSound?: boolean) => void;
  unlinkObjectFromSound: (objectId: string) => void;

  // Actions — diverse selection
  addToDiverseSelection: (objectId: string) => void;
  removeFromDiverseSelection: (objectId: string) => void;
  clearDiverseSelection: () => void;
  setDiverseSelection: (objectIds: string[]) => void;

  // Actions — entity selection
  setSelectedEntity: (entity: SelectedEntityInfo | null) => void;
  setSelectedObjectIds: (ids: string[]) => void;

  // Actions — colors
  applyFilterColors: () => void;
  clearFilterColors: () => void;
  registerMaterialColors: (colors: ColorGroup[]) => void;
  clearMaterialColors: () => void;

  // Actions — mode
  setFilteringEnabled: (enabled: boolean) => void;
  setViewMode: (mode: ViewMode) => void;

  // Selector helper
  getObjectLinkState: (objectId: string) => {
    isLinked: boolean;
    isDiverse: boolean;
    linkColor: string;
    linkedSoundIndex?: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scheduleApplyColors(applyFn: () => void) {
  if (_applyColorsTimer) clearTimeout(_applyColorsTimer);
  _applyColorsTimer = setTimeout(applyFn, 50);
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSpeckleStore = create<SpeckleStoreState>()(
  devtools(
    (set, get) => ({
      // ── SpeckleViewerContext state ─────────────────────────────────────────
      modelFileName: null,
      worldTreeVersion: 0,

      getViewerRef: () => _viewerRef,

      setViewer: (viewer) => {
        _viewerRef = viewer;
        // Re-apply any pending colors (material colors OR entity-sound links)
        // that were registered before the viewer was ready. Retry at increasing
        // intervals since FilteringExtension may take time to initialize.
        const hasPendingColors =
          _materialColorsRef.length > 0 ||
          _objectSoundLinksRef.size > 0 ||
          _diverseSelectedObjectIdsRef.size > 0;
        if (viewer && hasPendingColors) {
          setTimeout(() => get().applyFilterColors(), 200);
          setTimeout(() => get().applyFilterColors(), 1000);
        }
      },

      setModelFileName: (name) => {
        _modelFileNameRef = name;
        set({ modelFileName: name }, false, 'speckle/setModelFileName');
      },

      incrementWorldTreeVersion: () => {
        _worldTreeVersion += 1;
        set({ worldTreeVersion: _worldTreeVersion }, false, 'speckle/incrementWorldTreeVersion');
      },

      // ── SpeckleSelectionModeContext state ─────────────────────────────────
      objectSoundLinks: new Map(),
      generatedSoundObjectIds: new Set(),
      diverseSelectedObjectIds: new Set(),
      linkVersion: 0,
      selectedEntity: null,
      selectedObjectIds: [],
      filteringEnabled: false,
      viewMode: 'default',
      linkedObjectIds: new Set(),

      // ── Link management ───────────────────────────────────────────────────
      linkObjectToSound: (objectId, soundTabIndex, hasGeneratedSound = false) => {
        const {
          objectSoundLinks,
          generatedSoundObjectIds,
          diverseSelectedObjectIds,
          linkVersion,
          applyFilterColors,
        } = get();

        // Skip no-op
        if (objectSoundLinks.get(objectId) === soundTabIndex && !hasGeneratedSound) return;

        const nextLinks = new Map(objectSoundLinks);
        nextLinks.set(objectId, soundTabIndex);
        _objectSoundLinksRef = nextLinks;

        const nextGenerated = new Set(generatedSoundObjectIds);
        if (hasGeneratedSound) {
          nextGenerated.add(objectId);
        } else {
          nextGenerated.delete(objectId);
        }
        _generatedSoundObjectIdsRef = nextGenerated;

        const nextDiverse = new Set(diverseSelectedObjectIds);
        nextDiverse.delete(objectId);
        _diverseSelectedObjectIdsRef = nextDiverse;

        set(
          {
            objectSoundLinks: nextLinks,
            generatedSoundObjectIds: nextGenerated,
            diverseSelectedObjectIds: nextDiverse,
            linkedObjectIds: new Set(nextLinks.keys()),
            linkVersion: linkVersion + 1,
          },
          false,
          'speckle/linkObjectToSound',
        );
        scheduleApplyColors(applyFilterColors);
      },

      unlinkObjectFromSound: (objectId) => {
        const { objectSoundLinks, generatedSoundObjectIds, linkVersion, applyFilterColors } = get();
        if (!objectSoundLinks.has(objectId)) return;

        const nextLinks = new Map(objectSoundLinks);
        nextLinks.delete(objectId);
        _objectSoundLinksRef = nextLinks;

        const nextGenerated = new Set(generatedSoundObjectIds);
        nextGenerated.delete(objectId);
        _generatedSoundObjectIdsRef = nextGenerated;

        set(
          {
            objectSoundLinks: nextLinks,
            generatedSoundObjectIds: nextGenerated,
            linkedObjectIds: new Set(nextLinks.keys()),
            linkVersion: linkVersion + 1,
          },
          false,
          'speckle/unlinkObjectFromSound',
        );
        scheduleApplyColors(applyFilterColors);
      },

      // ── Diverse selection ─────────────────────────────────────────────────
      addToDiverseSelection: (objectId) => {
        const { diverseSelectedObjectIds, applyFilterColors } = get();
        if (diverseSelectedObjectIds.has(objectId)) return;
        const next = new Set(diverseSelectedObjectIds).add(objectId);
        _diverseSelectedObjectIdsRef = next;
        set({ diverseSelectedObjectIds: next }, false, 'speckle/addToDiverseSelection');
        scheduleApplyColors(applyFilterColors);
      },

      removeFromDiverseSelection: (objectId) => {
        const { diverseSelectedObjectIds, applyFilterColors } = get();
        if (!diverseSelectedObjectIds.has(objectId)) return;
        const next = new Set(diverseSelectedObjectIds);
        next.delete(objectId);
        _diverseSelectedObjectIdsRef = next;
        set({ diverseSelectedObjectIds: next }, false, 'speckle/removeFromDiverseSelection');
        scheduleApplyColors(applyFilterColors);
      },

      clearDiverseSelection: () => {
        const { diverseSelectedObjectIds, applyFilterColors } = get();
        if (diverseSelectedObjectIds.size === 0) return;
        const empty = new Set<string>();
        _diverseSelectedObjectIdsRef = empty;
        set({ diverseSelectedObjectIds: empty }, false, 'speckle/clearDiverseSelection');
        scheduleApplyColors(applyFilterColors);
      },

      setDiverseSelection: (objectIds) => {
        const { diverseSelectedObjectIds, applyFilterColors } = get();
        const prevArr = Array.from(diverseSelectedObjectIds).sort();
        const nextArr = [...objectIds].sort();
        if (
          prevArr.length === nextArr.length &&
          prevArr.every((id, i) => id === nextArr[i])
        )
          return;
        const next = new Set(objectIds);
        _diverseSelectedObjectIdsRef = next;
        set({ diverseSelectedObjectIds: next }, false, 'speckle/setDiverseSelection');
        scheduleApplyColors(applyFilterColors);
      },

      // ── Entity ────────────────────────────────────────────────────────────
      setSelectedEntity: (entity) =>
        set({ selectedEntity: entity }, false, 'speckle/setSelectedEntity'),

      setSelectedObjectIds: (ids) =>
        set({ selectedObjectIds: ids }, false, 'speckle/setSelectedObjectIds'),

      // ── Colors ────────────────────────────────────────────────────────────
      applyFilterColors: () => {
        if (!_viewerRef) return;
        if (_viewModeRef === 'dark') return;

        const filteringExt = _viewerRef.getExtension(FilteringExtension);
        if (!filteringExt) return;

        const currentLinks = _objectSoundLinksRef;
        const currentGenerated = _generatedSoundObjectIdsRef;
        const currentDiverse = _diverseSelectedObjectIdsRef;
        const materialColors = _materialColorsRef;

        const colorGroups: { objectIds: string[]; color: string }[] = [];

        if (materialColors.length > 0) colorGroups.push(...materialColors);

        const diverseOnlyIds = Array.from(currentDiverse).filter((id) => !currentLinks.has(id));
        if (diverseOnlyIds.length > 0)
          colorGroups.push({ objectIds: diverseOnlyIds, color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION });

        const pendingLinkedIds = Array.from(currentLinks.keys()).filter(
          (id) => !currentGenerated.has(id),
        );
        if (pendingLinkedIds.length > 0)
          colorGroups.push({
            objectIds: pendingLinkedIds,
            color: SPECKLE_FILTER_COLORS.SOUND_LINKED_PENDING,
          });

        const generatedLinkedIds = Array.from(currentLinks.keys()).filter((id) =>
          currentGenerated.has(id),
        );
        if (generatedLinkedIds.length > 0)
          colorGroups.push({
            objectIds: generatedLinkedIds,
            color: SPECKLE_FILTER_COLORS.SOUND_LINKED,
          });

        const sanitised = colorGroups
          .map((g) => ({
            ...g,
            objectIds: g.objectIds.filter((id) => typeof id === 'string' && id.length > 0),
          }))
          .filter((g) => g.objectIds.length > 0);

        if (sanitised.length > 0) {
          try {
            filteringExt.setUserObjectColors(sanitised);
          } catch (err) {
            console.error('[speckleStore] setUserObjectColors failed:', err);
          }
        } else {
          filteringExt.removeUserObjectColors();
        }
      },

      clearFilterColors: () => {
        if (!_viewerRef) return;
        const filteringExt = _viewerRef.getExtension(FilteringExtension);
        if (filteringExt) {
          filteringExt.removeUserObjectColors();
          _viewerRef.requestRender();
        }
      },

      registerMaterialColors: (colors) => {
        _materialColorsRef = colors;
        // Try to apply immediately; if FilteringExtension isn't ready yet,
        // schedule retries (colors are stored in _materialColorsRef for later)
        if (_viewerRef) {
          const filteringExt = _viewerRef.getExtension(FilteringExtension);
          if (filteringExt) {
            get().applyFilterColors();
          } else {
            setTimeout(() => get().applyFilterColors(), 200);
          }
        }
      },

      clearMaterialColors: () => {
        _materialColorsRef = [];
        get().applyFilterColors();
      },

      // ── Mode ──────────────────────────────────────────────────────────────
      setFilteringEnabled: (enabled) =>
        set({ filteringEnabled: enabled }, false, 'speckle/setFilteringEnabled'),

      setViewMode: (mode) => {
        _viewModeRef = mode;
        set({ viewMode: mode }, false, 'speckle/setViewMode');
      },

      // ── Selector helper ───────────────────────────────────────────────────
      getObjectLinkState: (objectId) => {
        const { objectSoundLinks, diverseSelectedObjectIds, generatedSoundObjectIds } = get();
        const isLinked = objectSoundLinks.has(objectId);
        const isDiverse = diverseSelectedObjectIds.has(objectId);
        const hasGenerated = generatedSoundObjectIds.has(objectId);
        const linkedSoundIndex = objectSoundLinks.get(objectId);
        const linkColor = isLinked
          ? hasGenerated
            ? SPECKLE_FILTER_COLORS.SOUND_LINKED
            : SPECKLE_FILTER_COLORS.SOUND_LINKED_PENDING
          : isDiverse
            ? SPECKLE_FILTER_COLORS.DIVERSE_SELECTION
            : '#6b7280';
        return { isLinked, isDiverse, linkColor, linkedSoundIndex };
      },
    }),
    { name: 'speckleStore' },
  ),
);
