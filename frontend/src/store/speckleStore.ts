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

// ── Unified visibility model ────────────────────────────────────────────────
// FilteringExtension keeps ONE global hiddenObjects array and ONE global
// isolatedObjects array (see FilteringState). hide/isolate are mutually
// exclusive, and a stateKey or command-family change resets the internal ids
// dict (verified against @speckle/viewer@2.26.9 source). To make ObjectExplorer
// hide/isolate + acoustic-layer visibility compose reliably, we keep the user's
// INTENT in the sets below, derive a single target {hidden|isolated}, and apply
// it atomically via applyVisibility() using ONE stateKey. No per-frame re-apply.
const VISIBILITY_STATE_KEY = 'explorer';

/** Non-acoustic ids the user hid in Default/Dark mode. */
let _userHiddenIds = new Set<string>();
/** Non-acoustic ids the user isolated in Default/Dark mode. */
let _userIsolatedIds = new Set<string>();
/** Last applied hidden/isolated sets (my own bookkeeping for idempotency). */
let _appliedHiddenIds: string[] = [];
let _appliedIsolatedIds: string[] = [];

// ── Acoustic explorer hidden tracking ──────────────────────────────────────
// When the ObjectExplorer's "Hide" button is clicked in acoustic mode, the
// target IDs are stored here ("exclude from acoustic layer"). The acoustic
// layer isolation excludes these IDs so the user's action takes effect.
let _acousticExplorerHiddenIds = new Set<string>();
let _acousticLayerAllIds: string[] = [];
/** All geometry leaf ids in the loaded model — needed to hide "non-acoustic"
  * objects in acoustic mode (hide-based isolation). */
let _allModelGeometryIds: string[] = [];

/** Temporary acoustic-layer preview ids while the user is in acoustic layer
  * selection mode (not yet committed). When non-null, applyVisibility uses these
  * instead of the committed _acousticLayerAllIds. Cleared on commit/cancel. */
let _selectionPreviewIds: string[] | null = null;

export function setSelectionPreviewIds(ids: string[] | null): void {
  _selectionPreviewIds = ids;
}

export function getAllModelGeometryIds(): string[] {
  return _allModelGeometryIds;
}

export function setAllModelGeometryIds(ids: string[]): void {
  _allModelGeometryIds = ids;
}

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

function arraysEqualSorted(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

/** Clear the SelectionExtension selection and the hover highlight for the given
  * ids. The SelectionExtension/highlight materials are applied AFTER the
  * FilteringExtension materials, so a selected/hovered object would otherwise
  * visually "reappear" right after being hidden. We clear the whole selection
  * (no id re-resolution through the WorldTree, which breaks on duplicated ids)
  * and the hover highlight via the Viewer's own reset helpers. */
function clearSelectionAndHighlight(hidden: string[]): void {
  if (!_viewerRef || hidden.length === 0) return;
  let clearedSelection = false;
  try {
    const sel = _viewerRef.getExtension(SelectionExtension);
    if (sel && typeof sel.clearSelection === 'function') {
      if (typeof sel.getSelectedObjects === 'function' && sel.getSelectedObjects().length > 0) {
        clearedSelection = true;
      }
      sel.clearSelection();
    }
  } catch { /* non-critical */ }
  try {
    const viewer = _viewerRef as unknown as { resetHighlight?: () => void };
    if (typeof viewer.resetHighlight === 'function') viewer.resetHighlight();
  } catch { /* non-critical */ }
  // Keep the canonical selection in sync so the ObjectExplorer row highlight
  // does not stay stale when hiding cleared the viewer's SelectionExtension.
  if (clearedSelection) {
    try { useSpeckleStore.getState().setSelectedObjectIds([]); } catch { /* non-critical */ }
  }
}

/** Read the live hidden ids from the FilteringExtension (ground truth). */
function readFilteringHidden(): Set<string> {
  if (!_viewerRef) return new Set();
  try {
    const ext = _viewerRef.getExtension(FilteringExtension);
    const hidden = ext?.filteringState?.hiddenObjects;
    if (hidden) return new Set<string>(hidden);
  } catch { /* fall through */ }
  return new Set();
}

/** Read the live isolated ids from the FilteringExtension (ground truth). */
function readFilteringIsolated(): string[] | null {
  if (!_viewerRef) return null;
  try {
    const ext = _viewerRef.getExtension(FilteringExtension);
    const isolated = ext?.filteringState?.isolatedObjects;
    if (isolated && isolated.length > 0) return Array.from(new Set<string>(isolated));
  } catch { /* fall through */ }
  return null;
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
  // ── Unified visibility model ──────────────────────────────────────────────
  /** Reactive mirror of the user's DV hide intent (non-acoustic ids). */
  userHiddenIds: string[];
  /** Reactive mirror of the user's DV isolate intent (non-acoustic ids). */
  userIsolatedIds: string[];
  /** Reactive mirror of the currently applied hidden ids. */
  appliedHiddenIds: string[];
  /** Reactive mirror of the currently applied isolated ids. */
  appliedIsolatedIds: string[];
  hideUserObjects: (ids: string[]) => void;
  showUserObjects: (ids: string[]) => void;
  isolateUserObjects: (ids: string[]) => void;
  unIsolateUserObjects: (ids: string[]) => void;
  /** Reset all user visibility intent (hide + isolate + acoustic excludes). */
  resetUserVisibility: () => void;
  /** Compute + apply the single target FilteringExtension state. Idempotent. */
  applyVisibility: () => void;

  // Actions — mode
  setFilteringEnabled: (enabled: boolean) => void;
  setViewMode: (mode: ViewMode) => void;

  // Analysis object groups (from model-analysis card)
  analysisObjectGroups: ColorGroup[];
  setAnalysisObjectGroups: (groups: ColorGroup[], objects: ArchitecturalObject[]) => void;
  clearAnalysisObjectGroups: () => void;

  // Isolation state reader (synchronous, bypasses Zustand to avoid re-renders)
  /** Live set of ids hidden in the viewer (ground truth from FilteringExtension). */
  getExplorerHiddenIds: () => Set<string>;
  /** Live isolated ids in the viewer, or null if none. */
  getExplorerIsolatedIds: () => string[] | null;

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
        const isNewViewer = viewer !== null && viewer !== _viewerRef;
        _viewerRef = viewer;
        // A fresh viewer means a fresh model: reset the unified visibility
        // intent/applied state so stale ids from the previous model don't leak.
        if (isNewViewer) {
          _userHiddenIds = new Set();
          _userIsolatedIds = new Set();
          _acousticExplorerHiddenIds = new Set();
          _acousticLayerAllIds = [];
          _allModelGeometryIds = [];
          _selectionPreviewIds = null;
          _appliedHiddenIds = [];
          _appliedIsolatedIds = [];
          set(
            {
              userHiddenIds: [],
              userIsolatedIds: [],
              appliedHiddenIds: [],
              appliedIsolatedIds: [],
              acousticExplorerHiddenIds: [],
            },
            false,
            'speckle/setViewerReset',
          );
        }
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
      userHiddenIds: [],
      userIsolatedIds: [],
      appliedHiddenIds: [],
      appliedIsolatedIds: [],
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

        const viewer = _viewerRef;
        const filteringExt = viewer.getExtension(FilteringExtension);
        if (!filteringExt) return;

        // Read the applied visibility from the FilteringExtension (single source
        // of truth — applyVisibility keeps it coherent). Colors are suppressed for
        // hidden ids and, when isolation is active, for non-isolated ids.
        const fs = filteringExt.filteringState;
        const hiddenSet = new Set<string>(fs?.hiddenObjects ?? []);
        const isolatedArr = fs?.isolatedObjects ?? [];
        const isolatedSet = isolatedArr.length > 0 ? new Set<string>(isolatedArr) : null;
        const isExcluded = (id: string) =>
          hiddenSet.has(id) || (isolatedSet !== null && !isolatedSet.has(id));

        // A Brep shares its display mesh's render view with the display Mesh
        // object (both resolve to the same render view). If one object is hidden
        // and the other is still colored, setFilters applies COLORED after
        // HIDDEN, so the shared render view stays visible. Detect this: exclude
        // a color id when ANY of its render views is in the hide set.
        let hiddenRvGuids: Set<string> | null = null;
        try {
          const vs = (filteringExt as unknown as { VisibilityState?: { rvs?: { guid?: string }[] } })
            .VisibilityState;
          if (vs?.rvs?.length) {
            hiddenRvGuids = new Set(vs.rvs.map((rv) => rv.guid as string).filter(Boolean));
          }
        } catch { /* ignore */ }
        const hasHiddenRenderView = (id: string): boolean => {
          if (!hiddenRvGuids) return false;
          try {
            const rvs = viewer
              .getWorldTree()
              .getRenderTree()
              .getRenderViewsForNodeId(id);
            return (rvs || []).some((rv) => hiddenRvGuids!.has(rv.guid));
          } catch {
            return false;
          }
        };

        const currentLinks = _objectSoundLinksRef;
        const currentGenerated = _generatedSoundObjectIdsRef;
        const currentDiverse = _diverseSelectedObjectIdsRef;
        const materialColors = _materialColorsRef;

        const colorGroups: { objectIds: string[]; color: string }[] = [];

        if (materialColors.length > 0) {
          // Material colors must respect visibility: setFilters applies user
          // colors AFTER the HIDDEN/GHOST material, so a colored object would
          // override its own hide and stay visible. Filter hidden (and, when
          // isolation is active, non-isolated) ids out of the material groups,
          // plus any id whose (shared) render view is already hidden.
          const filtered = materialColors
            .map((g) => ({
              ...g,
              objectIds: g.objectIds.filter((id) => !isExcluded(id) && !hasHiddenRenderView(id)),
            }))
            .filter((g) => g.objectIds.length > 0);
          colorGroups.push(...filtered);
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
        // mechanism as the hover highlight, but with the light warning colour. Inserted
        // BEFORE the hover block so a hovered reference (warning orange) still wins over
        // the scenario highlight for the same object.
        const scenarioPreviewIds = _scenarioPreviewIds.filter((id) => !isExcluded(id));
        if (scenarioPreviewIds.length > 0) {
          for (const previewId of scenarioPreviewIds) {
            for (const g of colorGroups) {
              const idx = g.objectIds.indexOf(previewId);
              if (idx !== -1) g.objectIds.splice(idx, 1);
            }
          }
          const scenarioPreviewColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-warning-light')
            .trim();
          colorGroups.push({ objectIds: scenarioPreviewIds, color: scenarioPreviewColor });
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
          const warningColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-warning')
            .trim();
          colorGroups.push({ objectIds: expandedHoverIds, color: warningColor });
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

      // ── Unified visibility model ──────────────────────────────────────────
      getExplorerHiddenIds: () => readFilteringHidden(),

      hideUserObjects: (ids) => {
        ids.forEach((id) => _userHiddenIds.add(id));
        set({ userHiddenIds: [..._userHiddenIds] }, false, 'speckle/hideUserObjects');
        get().applyVisibility();
      },
      showUserObjects: (ids) => {
        ids.forEach((id) => _userHiddenIds.delete(id));
        set({ userHiddenIds: [..._userHiddenIds] }, false, 'speckle/showUserObjects');
        get().applyVisibility();
      },
      isolateUserObjects: (ids) => {
        const existing = new Set(_userIsolatedIds);
        ids.forEach((id) => {
          existing.add(id);
          _userHiddenIds.delete(id); // isolating un-hides
        });
        _userIsolatedIds = existing;
        set(
          { userIsolatedIds: [..._userIsolatedIds], userHiddenIds: [..._userHiddenIds] },
          false,
          'speckle/isolateUserObjects',
        );
        get().applyVisibility();
      },
      unIsolateUserObjects: (ids) => {
        const existing = new Set(_userIsolatedIds);
        ids.forEach((id) => existing.delete(id));
        _userIsolatedIds = existing;
        set({ userIsolatedIds: [..._userIsolatedIds] }, false, 'speckle/unIsolateUserObjects');
        get().applyVisibility();
      },
      resetUserVisibility: () => {
        _userHiddenIds = new Set();
        _userIsolatedIds = new Set();
        _acousticExplorerHiddenIds = new Set();
        set(
          {
            userHiddenIds: [],
            userIsolatedIds: [],
            acousticExplorerHiddenIds: [],
          },
          false,
          'speckle/resetUserVisibility',
        );
        get().applyVisibility();
      },

      applyVisibility: () => {
        if (!_viewerRef) return;
        const ext = _viewerRef.getExtension(FilteringExtension);
        if (!ext) return;

        const mode = _viewModeRef;
        const acousticIds = _selectionPreviewIds ?? _acousticLayerAllIds;
        const excluded = _acousticExplorerHiddenIds;

        let isolated: string[] = [];
        let hidden: string[] = [];

        if (mode === 'acoustic') {
          // Hide-based isolation: hide everything that is NOT in the acoustic
          // layer, plus any excluded acoustic objects. This lets "exclude" fully
          // hide an object (FilteringExtension cannot express both an isolated
          // set AND a separate hidden set). When no acoustic layer is defined
          // yet (selection mode / whole model), show everything.
          if (acousticIds.length > 0) {
            const acousticSet = new Set(acousticIds);
            hidden = [
              ..._allModelGeometryIds.filter((id) => !acousticSet.has(id)),
              ...Array.from(excluded),
            ];
          }
        } else {
          const userIso = Array.from(_userIsolatedIds);
          if (userIso.length > 0) {
            isolated = userIso;
          } else {
            hidden = [...Array.from(_userHiddenIds), ...acousticIds];
          }
        }

        // Idempotency: skip if this exact target is already applied.
        if (
          arraysEqualSorted(isolated, _appliedIsolatedIds) &&
          arraysEqualSorted(hidden, _appliedHiddenIds)
        ) {
          return;
        }

        // Selection / hover highlight materials override FilteringExtension's
        // HIDDEN material — deselect & un-highlight now-hidden ids BEFORE the
        // filter is applied, otherwise a selected/hovered object visually
        // "reappears" right after being hidden.
        clearSelectionAndHighlight(hidden);

        try {
          // resetFilters clears visibility AND user object colors; a single
          // command on one stateKey then re-establishes the target atomically.
          ext.resetFilters();
          if (isolated.length > 0) {
            ext.isolateObjects(isolated, VISIBILITY_STATE_KEY, true, true);
          } else if (hidden.length > 0) {
            ext.hideObjects(hidden, VISIBILITY_STATE_KEY, true, false);
          }
        } catch (err) {
          console.error('[speckleStore] applyVisibility failed:', err);
        }

        _appliedHiddenIds = hidden;
        _appliedIsolatedIds = isolated;
        set(
          { appliedHiddenIds: hidden, appliedIsolatedIds: isolated },
          false,
          'speckle/applyVisibility',
        );

        // resetFilters wiped setUserObjectColors — restore entity/material colors.
        get().applyFilterColors();
        _viewerRef.requestRender();
      },

      // ── Acoustic explorer hidden tracking ────────────────────────────────
      addAcousticExplorerHiddenId: (id) => {
        if (_acousticExplorerHiddenIds.has(id)) return;
        _acousticExplorerHiddenIds.add(id);
        set({ acousticExplorerHiddenIds: [..._acousticExplorerHiddenIds] }, false, 'speckle/addAcousticExplorerHiddenId');
        get().applyVisibility();
      },

      removeAcousticExplorerHiddenId: (id) => {
        if (!_acousticExplorerHiddenIds.has(id)) return;
        _acousticExplorerHiddenIds.delete(id);
        set({ acousticExplorerHiddenIds: [..._acousticExplorerHiddenIds] }, false, 'speckle/removeAcousticExplorerHiddenId');
        get().applyVisibility();
      },

      clearAcousticExplorerHiddenIds: () => {
        _acousticExplorerHiddenIds = new Set<string>();
        set({ acousticExplorerHiddenIds: [] }, false, 'speckle/clearAcousticExplorerHiddenIds');
        get().applyVisibility();
      },

      // ── Mode ──────────────────────────────────────────────────────────────
      setFilteringEnabled: (enabled) =>
        set({ filteringEnabled: enabled }, false, 'speckle/setFilteringEnabled'),

      setViewMode: (mode) => {
        _viewModeRef = mode;
        set({ viewMode: mode }, false, 'speckle/setViewMode');
        get().applyVisibility();
      },

      // ── Isolation state reader ────────────────────────────────────────────
      getExplorerIsolatedIds: () => readFilteringIsolated(),

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
