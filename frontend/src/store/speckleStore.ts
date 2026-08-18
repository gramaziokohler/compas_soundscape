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
import { FilteringExtension, CameraController, SelectionExtension, type Viewer } from '@speckle/viewer';
import type React from 'react';
import type { ArchitecturalObject } from '@/types/analysis';
import { useUIStore } from './uiStore';
import { useSoundscapeStore } from './soundscapeStore';

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
let _analysisObjectGroupsRef: ColorGroup[] = [];
let _analysisResultGroupsRef: ArchitecturalObject[] = [];
let _viewModeRef: ViewMode = 'default';

/** Read current analysis result groups (for EntityInfoPanel lookup — no re-render) */
export function getAnalysisResultGroups(): ArchitecturalObject[] {
  return _analysisResultGroupsRef;
}
/** True while setUserObjectColors is active on the FilteringExtension (cleared by removeUserObjectColors) */
let _userColorsApplied = false;
/** IDs explicitly hidden — keyed by stateKey for per-context tracking (ObjectExplorer states, acoustic materials) */
let _explorerHiddenIdsByKey: Map<string, Set<string>> = new Map();
/** Currently isolated object IDs — keyed by stateKey, null means no isolation active for that key */
let _explorerIsolatedIdsByKey: Map<string, Set<string>> = new Map();

// ── Post-isolate hide compensation ──────────────────────────────────────────
// Speckle's isolateObjects(ghost=true) clears hidden state from ALL stateKeys,
// not just its own. After each isolate call, we must immediately re-apply
// the acoustic layer's hide state before the viewer renders.
let _postIsolateHideIds: string[] | null = null;

/** Set by useAcousticLayerIsolation whenever the hidden geometry set changes. */
export function setPostIsolateHideIds(ids: string[] | null) {
  _postIsolateHideIds = ids;
}

/** Called by useSpeckleFiltering immediately after isolateObjects to re-apply
  * the acoustic layer's hide state that Speckle just cleared. Does NOT request
  * a render — the caller handles that after re-isolating. */
export function reapplyPostIsolateHides() {
  if (!_viewerRef || !_postIsolateHideIds || _postIsolateHideIds.length === 0) return;
  try {
    const ext = _viewerRef.getExtension(FilteringExtension);
    if (ext) {
      ext.hideObjects(_postIsolateHideIds, 'acoustic-materials', true, false);
    }
  } catch { /* non-critical */ }
}

// ── Acoustic explorer hidden tracking ──────────────────────────────────────
// When the ObjectExplorer's "Hide" button is clicked in acoustic mode, the
// target IDs are stored here. The acoustic layer isolation must exclude these
// IDs so the user's hide action actually takes effect. Module-level (not in
// Zustand) so the rAF re-apply loop in useAcousticLayerIsolation can read
// them without stale closure issues.
let _acousticExplorerHiddenIds = new Set<string>();
let _acousticLayerAllIds: string[] = [];

export function getAcousticLayerAllIds(): string[] {
  return _acousticLayerAllIds;
}

export function setAcousticLayerAllIds(ids: string[]): void {
  _acousticLayerAllIds = ids;
}

export function getAcousticExplorerHiddenIds(): Set<string> {
  return _acousticExplorerHiddenIds;
}

export function clearAcousticExplorerHiddenIds(): void {
  _acousticExplorerHiddenIds = new Set<string>();
}

function getOrCreateHiddenSet(key: string): Set<string> {
  let s = _explorerHiddenIdsByKey.get(key);
  if (!s) { s = new Set<string>(); _explorerHiddenIdsByKey.set(key, s); }
  return s;
}

function getOrCreateIsolatedSet(key: string): Set<string> {
  let s = _explorerIsolatedIdsByKey.get(key);
  if (!s) { s = new Set<string>(); _explorerIsolatedIdsByKey.set(key, s); }
  return s;
}

function getUnionHidden(): Set<string> {
  const all = new Set<string>();
  for (const s of _explorerHiddenIdsByKey.values()) {
    for (const id of s) all.add(id);
  }
  return all;
}

function getUnionIsolated(): Set<string> | null {
  let all: Set<string> | null = null;
  for (const s of _explorerIsolatedIdsByKey.values()) {
    if (s.size === 0) continue;
    if (!all) all = new Set<string>();
    for (const id of s) all.add(id);
  }
  return all;
}

/** Model fileName from SpeckleViewerContext */
let _modelFileNameRef: string | null = null;

/** worldTreeVersion held as a ref so we can increment without re-read */
let _worldTreeVersion = 0;

// Debounce handle for applyFilterColors
let _applyColorsTimer: ReturnType<typeof setTimeout> | null = null;
let _hoverHighlightIds: string[] = [];
/** Scenario preview highlight (expanded scenario card) — colored like the hover
 *  highlight but with the light primary colour. Kept in a module ref so it
 *  survives every applyFilterColors() re-apply. */
let _scenarioPreviewIds: string[] = [];

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
  /** Clears the Speckle SelectionExtension highlight AND the app selection state. */
  clearViewerSelection: () => void;

  // Actions — colors
  applyFilterColors: () => void;
  clearFilterColors: () => void;
  registerMaterialColors: (colors: ColorGroup[]) => void;
  clearMaterialColors: () => void;
  // Object Explorer hide/show tracking (so applyFilterColors can suppress colors for hidden objects)
  trackExplorerHide: (ids: string[], stateKey: string) => void;
  trackExplorerShow: (ids: string[], stateKey: string) => void;
  clearExplorerHidden: (stateKey: string) => void;
  /** Returns the live set of object IDs hidden via the ObjectExplorer for the given stateKey, or union of all if omitted. */
  getExplorerHiddenIds: (stateKey?: string) => Set<string>;
  // Object Explorer isolation tracking (so applyFilterColors can suppress colors for non-isolated objects)
  trackExplorerIsolate: (ids: string[], stateKey: string) => void;
  /** Remove specific IDs from the isolation set (un-isolate without clearing all isolation) */
  removeFromExplorerIsolation: (ids: string[], stateKey: string) => void;
  clearExplorerIsolation: (stateKey: string) => void;
  /** Reactive copy of _explorerIsolatedIdsRef — null means no isolation active */
  explorerIsolatedIds: string[] | null;

  // Actions — mode
  setFilteringEnabled: (enabled: boolean) => void;
  setViewMode: (mode: ViewMode) => void;

  // Analysis object groups (from model-analysis card)
  analysisObjectGroups: ColorGroup[];
  setAnalysisObjectGroups: (groups: ColorGroup[], objects: ArchitecturalObject[]) => void;
  clearAnalysisObjectGroups: () => void;

  // Isolation state reader (synchronous, bypasses Zustand to avoid re-renders)
  getExplorerIsolatedIds: (stateKey?: string) => string[] | null;

  // Selector helper
  getObjectLinkState: (objectId: string) => {
    isLinked: boolean;
    isDiverse: boolean;
    linkColor: string;
    linkedSoundIndex?: number;
  };

  // Acoustic explorer hidden tracking (for ObjectExplorer hide in acoustic mode)
  acousticExplorerHiddenIds: string[];
  addAcousticExplorerHiddenId: (id: string) => void;
  removeAcousticExplorerHiddenId: (id: string) => void;
  clearAcousticExplorerHiddenIds: () => void;
  applyAcousticExplorerHiddenIsolation: () => void;

  // Scenario hover/zoom helpers
  highlightObjectForHover: (objectId: string | string[]) => void;
  clearHoverHighlight: () => void;
  // Scenario preview highlight (expanded scenario card — light primary colour)
  setScenarioPreviewHighlight: (objectIds: string[]) => void;
  clearScenarioPreviewHighlight: () => void;
  zoomToObjectById: (objectId: string | string[]) => void;
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
          _diverseSelectedObjectIdsRef.size > 0 ||
          _analysisObjectGroupsRef.length > 0;
        console.log('[speckleStore] setViewer \u2014 hasPendingColors:', hasPendingColors, '(material:', _materialColorsRef.length, 'links:', _objectSoundLinksRef.size, 'diverse:', _diverseSelectedObjectIdsRef.size, 'analysisGroups:', _analysisObjectGroupsRef.length, ')');
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
      explorerIsolatedIds: null,
      analysisObjectGroups: [],
      acousticExplorerHiddenIds: [],

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

      clearViewerSelection: () => {
        try {
          const viewer = get().getViewerRef();
          viewer?.getExtension(SelectionExtension)?.clearSelection();
        } catch (err) {
          console.warn('[speckleStore] clearViewerSelection failed:', err);
        }
        set({ selectedObjectIds: [], selectedEntity: null }, false, 'speckle/clearViewerSelection');
      },

      // ── Colors ────────────────────────────────────────────────────────────
      applyFilterColors: () => {
        if (!_viewerRef) return;
        if (_viewModeRef === 'dark') return;

        const filteringExt = _viewerRef.getExtension(FilteringExtension);
        if (!filteringExt) return;

        // Use explicitly-tracked hidden IDs (union of all stateKeys so colors are suppressed
        // regardless of which ObjectExplorer context hid them).
        const hiddenSet = getUnionHidden();
        // When isolation is active, objects NOT in the isolated set are ghosted/hidden too
        // (union of all stateKeys).
        const isolatedSet = getUnionIsolated();
        const isExcluded = (id: string) =>
          hiddenSet.has(id) || (isolatedSet !== null && !isolatedSet.has(id));

        const currentLinks = _objectSoundLinksRef;
        const currentGenerated = _generatedSoundObjectIdsRef;
        const currentDiverse = _diverseSelectedObjectIdsRef;
        const materialColors = _materialColorsRef;

        const colorGroups: { objectIds: string[]; color: string }[] = [];

        if (materialColors.length > 0) {
          // Material colors bypass the exclusion check — they are explicit
          // user assignments and should always render. The FilteringExtension
          // independently handles visibility of hidden/isolated objects.
          colorGroups.push(...materialColors);
        }

        // Analysis object groups (model-analysis card coloring)
        if (_analysisObjectGroupsRef.length > 0) {
          const filtered = _analysisObjectGroupsRef
            .map((g) => ({ ...g, objectIds: g.objectIds.filter((id) => !isExcluded(id)) }))
            .filter((g) => g.objectIds.length > 0);
          colorGroups.push(...filtered);
        }

        const diverseOnlyIds = Array.from(currentDiverse).filter(
          (id) => !currentLinks.has(id) && !isExcluded(id),
        );
        if (diverseOnlyIds.length > 0)
          colorGroups.push({ objectIds: diverseOnlyIds, color: 'var(--color-success)' });

        // Only color entity-linked objects when in the Sounds step, and only for
        // the active parent's sounds. When activeSoundParentIndex is null (skipped flow),
        // show all unparented sounds.
        const { activeSoundParentIndex, isInSoundsStep } = useUIStore.getState();

        if (isInSoundsStep) {
          // Build the set of promptIndices that belong to the active parent.
          const soundConfigs = useSoundscapeStore.getState().soundConfigs;
          const activePromptIndices = new Set<number>(
            soundConfigs.reduce<number[]>((acc, cfg, idx) => {
              const matches = activeSoundParentIndex !== null
                ? cfg.parentUsageOriginalIndex === activeSoundParentIndex
                : cfg.parentUsageOriginalIndex === undefined || cfg.parentUsageOriginalIndex === null;
              if (matches) acc.push(idx);
              return acc;
            }, []),
          );

          // Only include links whose promptIndex is in the active parent's set.
          const isActiveLink = (id: string) => {
            const promptIndex = currentLinks.get(id);
            return promptIndex !== undefined && activePromptIndices.has(promptIndex);
          };

          const pendingLinkedIds = Array.from(currentLinks.keys()).filter(
            (id) => !currentGenerated.has(id) && !isExcluded(id) && isActiveLink(id),
          );
          const pendingColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-primary-lighter')
            .trim();
          const generatedColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-primary')
            .trim();

          if (pendingLinkedIds.length > 0)
            colorGroups.push({
              objectIds: pendingLinkedIds,
              color: pendingColor,
            });

          const generatedLinkedIds = Array.from(currentLinks.keys()).filter(
            (id) => currentGenerated.has(id) && !isExcluded(id) && isActiveLink(id),
          );
          if (generatedLinkedIds.length > 0)
            colorGroups.push({
              objectIds: generatedLinkedIds,
              color: generatedColor,
            });
        }

        // Scenario preview highlight (expanded scenario card). Same FilteringExtension
        // mechanism as the hover highlight, but with the light primary colour. Inserted
        // BEFORE the hover block so a hovered reference (success green) still wins over
        // the scenario highlight for the same object.
        const scenarioPreviewIds = _scenarioPreviewIds.filter((id) => !isExcluded(id));
        if (scenarioPreviewIds.length > 0) {
          for (const previewId of scenarioPreviewIds) {
            for (const g of colorGroups) {
              const idx = g.objectIds.indexOf(previewId);
              if (idx !== -1) g.objectIds.splice(idx, 1);
            }
          }
          const primaryLightColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-success-light')
            .trim();
          colorGroups.push({ objectIds: scenarioPreviewIds, color: primaryLightColor });
        }

        // Hover highlight (scenario object reference hover)
        // Resolve the CSS variable to a concrete color string — the Speckle viewer's
        // THREE.js-based color parser cannot handle var() syntax and defaults to white.
        // Also remove each hover ID from any earlier color group so Speckle doesn't keep
        // whichever assignment it sees first for a given object ID.
        const hoverIds = _hoverHighlightIds.filter((id) => !isExcluded(id));
        if (hoverIds.length > 0) {
          // Expand hover IDs to their full analysis groups so that hovering over
          // a single object reference highlights ALL objects in the same group.
          const expandedHoverSet = new Set<string>();
          for (const hid of hoverIds) {
            expandedHoverSet.add(hid);
            for (const group of _analysisResultGroupsRef) {
              const groupIds = Object.keys(group.object_ids ?? {});
              if (groupIds.includes(hid)) {
                for (const gid of groupIds) {
                  if (!isExcluded(gid)) expandedHoverSet.add(gid);
                }
              }
            }
          }
          const expandedHoverIds = Array.from(expandedHoverSet);

          for (const hoverId of expandedHoverIds) {
            for (const g of colorGroups) {
              const idx = g.objectIds.indexOf(hoverId);
              if (idx !== -1) g.objectIds.splice(idx, 1);
            }
          }
          const successColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-success')
            .trim();
          colorGroups.push({ objectIds: expandedHoverIds, color: successColor });
        }

        const sanitised = colorGroups
          .map((g) => ({
            ...g,
            objectIds: g.objectIds.filter((id) => typeof id === 'string' && id.length > 0),
          }))
          .filter((g) => g.objectIds.length > 0);

        if (sanitised.length > 0) {
          try {
            filteringExt.setUserObjectColors(sanitised);
            _userColorsApplied = true;
          } catch (err) {
            console.error('[speckleStore] setUserObjectColors failed:', err);
          }
        } else {
          filteringExt.removeUserObjectColors();
          _userColorsApplied = false;
        }
      },

      clearFilterColors: () => {
        if (!_viewerRef) return;
        const filteringExt = _viewerRef.getExtension(FilteringExtension);
        if (filteringExt) {
          filteringExt.removeUserObjectColors();
          _userColorsApplied = false;
          _viewerRef.requestRender();
        }
      },

      // ── Analysis object groups (model-analysis card) ──────────────────────
      setAnalysisObjectGroups: (groups, objects) => {
        _analysisObjectGroupsRef = groups;
        _analysisResultGroupsRef = objects;
        set({ analysisObjectGroups: groups }, false, 'speckle/setAnalysisObjectGroups');
        scheduleApplyColors(get().applyFilterColors);
      },

      clearAnalysisObjectGroups: () => {
        _analysisObjectGroupsRef = [];
        _analysisResultGroupsRef = [];
        set({ analysisObjectGroups: [] }, false, 'speckle/clearAnalysisObjectGroups');
        scheduleApplyColors(get().applyFilterColors);
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
        if (_viewModeRef === 'dark') {
          // applyFilterColors() is a no-op in dark mode, but stale setUserObjectColors
          // from acoustic mode must still be cleared — otherwise the active color groups
          // in FilteringExtension conflict with subsequent hideObjects() calls and keep
          // objects visible that should be hidden (Acoustic → Dark with materials).
          // Only call removeUserObjectColors() if colors are actually active; skipping
          // when _userColorsApplied=false avoids unnecessary FilteringExtension resets
          // during card switches while already in dark mode.
          if (_userColorsApplied && _viewerRef) {
            const filteringExt = _viewerRef.getExtension(FilteringExtension);
            if (filteringExt) {
              try {
                filteringExt.removeUserObjectColors();
                _userColorsApplied = false;
                _viewerRef.requestRender();
              } catch { /* non-critical */ }
            }
          }
        } else {
          get().applyFilterColors();
        }
      },

      // ── Object Explorer hide tracking ─────────────────────────────────────
      // These keep _explorerHiddenIdsByKey / _explorerIsolatedIdsByKey in sync so
      // applyFilterColors can suppress colors for hidden/isolated objects per stateKey.
      getExplorerHiddenIds: (stateKey) => {
        if (stateKey !== undefined) {
          return new Set(getOrCreateHiddenSet(stateKey));
        }
        // When no key is given, read the merged state from the FilteringExtension
        // (the ground truth), falling back to the local union of all tracked keys.
        if (_viewerRef) {
          try {
            const ext = _viewerRef.getExtension(FilteringExtension);
            const hidden = ext?.filteringState?.hiddenObjects;
            if (hidden) return new Set<string>(hidden);
          } catch { /* fall through */ }
        }
        return getUnionHidden();
      },

      trackExplorerHide: (ids, stateKey) => {
        const s = getOrCreateHiddenSet(stateKey);
        ids.forEach((id) => s.add(id));
        get().applyFilterColors();
      },
      trackExplorerShow: (ids, stateKey) => {
        const s = getOrCreateHiddenSet(stateKey);
        ids.forEach((id) => s.delete(id));
        get().applyFilterColors();
      },
      clearExplorerHidden: (stateKey) => {
        getOrCreateHiddenSet(stateKey).clear();
        get().applyFilterColors();
      },
      trackExplorerIsolate: (ids, stateKey) => {
        const isolatedSet = getOrCreateIsolatedSet(stateKey);
        const hiddenSet = getOrCreateHiddenSet(stateKey);
        ids.forEach((id) => hiddenSet.delete(id));
        ids.forEach((id) => isolatedSet.add(id));
        set({ explorerIsolatedIds: Array.from(isolatedSet) }, false, 'speckle/trackExplorerIsolate');
        get().applyFilterColors();
      },
      removeFromExplorerIsolation: (ids, stateKey) => {
        const s = getOrCreateIsolatedSet(stateKey);
        if (s.size === 0) return;
        ids.forEach((id) => s.delete(id));
        set({ explorerIsolatedIds: s.size > 0 ? Array.from(s) : null }, false, 'speckle/removeFromExplorerIsolation');
        get().applyFilterColors();
      },
      clearExplorerIsolation: (stateKey) => {
        getOrCreateIsolatedSet(stateKey).clear();
        set({ explorerIsolatedIds: null }, false, 'speckle/clearExplorerIsolation');
        get().applyFilterColors();
      },

      // ── Acoustic explorer hidden tracking ────────────────────────────────
      addAcousticExplorerHiddenId: (id) => {
        if (_acousticExplorerHiddenIds.has(id)) return;
        _acousticExplorerHiddenIds.add(id);
        set({ acousticExplorerHiddenIds: [..._acousticExplorerHiddenIds] }, false, 'speckle/addAcousticExplorerHiddenId');
      },

      removeAcousticExplorerHiddenId: (id) => {
        if (!_acousticExplorerHiddenIds.has(id)) return;
        _acousticExplorerHiddenIds.delete(id);
        set({ acousticExplorerHiddenIds: [..._acousticExplorerHiddenIds] }, false, 'speckle/removeAcousticExplorerHiddenId');
      },

      clearAcousticExplorerHiddenIds: () => {
        _acousticExplorerHiddenIds = new Set<string>();
        set({ acousticExplorerHiddenIds: [] }, false, 'speckle/clearAcousticExplorerHiddenIds');
      },

      applyAcousticExplorerHiddenIsolation: () => {
        if (!_viewerRef) return;
        try {
          const ext = _viewerRef.getExtension(FilteringExtension);
          if (!ext) return;
          if (_acousticLayerAllIds.length === 0) return;
          const filtered = _acousticLayerAllIds.filter(
            (id) => !_acousticExplorerHiddenIds.has(id),
          );
          if (filtered.length === 0) return;

          // FilteringExtension's internal VisibilityState.ids dict is additive
          // (Object.assign) across consecutive isolateObjects calls on the same
          // stateKey + command family — it only resets when the stateKey or the
          // command family (isolate vs hide) changes. Re-calling isolateObjects
          // with a SMALLER list therefore never shrinks the isolated set: ids
          // missing from the new list simply stay isolated forever. The usual
          // "sandwich a hide-family call in between to force a reset" compose
          // pattern doesn't help here either, since reapplyPostIsolateHides()
          // is a no-op in acoustic mode (postIsolateHideIds is null while
          // isolation is active). Instead, diff against the previously tracked
          // isolated set and issue targeted unIsolateObjects/isolateObjects
          // calls only for the ids that actually changed — unIsolateObjects
          // explicitly deletes specific ids from the dict without resetting it.
          const isolatedSet = getOrCreateIsolatedSet('acoustic-materials');
          const desired = new Set(filtered);
          const toRemove = Array.from(isolatedSet).filter((id) => !desired.has(id));
          const toAdd = filtered.filter((id) => !isolatedSet.has(id));

          if (toRemove.length > 0) {
            ext.unIsolateObjects(toRemove, 'acoustic-materials', true, true);
          }
          if (toAdd.length > 0) {
            ext.isolateObjects(toAdd, 'acoustic-materials', true, true);
          }
          _viewerRef.requestRender();

          // Also update the tracked isolation set for the acoustic-materials key.
          isolatedSet.clear();
          filtered.forEach((id) => isolatedSet.add(id));
          set({ explorerIsolatedIds: Array.from(isolatedSet) }, false, 'speckle/applyAcousticExplorerHiddenIsolation');
          get().applyFilterColors();
        } catch { /* non-critical */ }
      },

      // ── Mode ──────────────────────────────────────────────────────────────
      setFilteringEnabled: (enabled) =>
        set({ filteringEnabled: enabled }, false, 'speckle/setFilteringEnabled'),

      setViewMode: (mode) => {
        _viewModeRef = mode;
        set({ viewMode: mode }, false, 'speckle/setViewMode');
      },

      // ── Isolation state reader ────────────────────────────────────────────
      getExplorerIsolatedIds: (stateKey) => {
        // When a specific stateKey is given, return its tracked set.
        if (stateKey !== undefined) {
          const s = _explorerIsolatedIdsByKey.get(stateKey);
          return s && s.size > 0 ? Array.from(s) : null;
        }
        // When no key is given, read from FilteringExtension for the complete merged
        // set — includes all descendants isolated via includeDescendants=true under any key.
        if (_viewerRef) {
          try {
            const ext = _viewerRef.getExtension(FilteringExtension);
            const isolated = ext?.filteringState?.isolatedObjects;
            if (isolated && isolated.length > 0) return Array.from(new Set<string>(isolated));
          } catch { /* fall through */ }
        }
        return getUnionIsolated() ? Array.from(getUnionIsolated()!) : null;
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
            ? 'var(--color-primary)'
            : 'var(--color-primary-light)'
          : isDiverse
            ? 'var(--color-success)'
            : 'var(--color-secondary-hover)';
        return { isLinked, isDiverse, linkColor, linkedSoundIndex };
      },

      highlightObjectForHover: (objectId) => {
        _hoverHighlightIds = Array.isArray(objectId) ? objectId : [objectId];
        get().applyFilterColors();
      },

      clearHoverHighlight: () => {
        _hoverHighlightIds = [];
        get().applyFilterColors();
      },

      setScenarioPreviewHighlight: (objectIds) => {
        _scenarioPreviewIds = Array.isArray(objectIds) ? objectIds : [objectIds];
        get().applyFilterColors();
      },

      clearScenarioPreviewHighlight: () => {
        _scenarioPreviewIds = [];
        get().applyFilterColors();
      },

      zoomToObjectById: (objectId) => {
        if (!_viewerRef) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cameraController = _viewerRef.getExtension(CameraController) as any;
          if (cameraController?.setCameraView) {
            const ids = Array.isArray(objectId) ? objectId : [objectId];
            cameraController.setCameraView(ids, true);
          }
        } catch { /* ignore */ }
      },
    }),
    { name: 'speckleStore' },
  ),
);
