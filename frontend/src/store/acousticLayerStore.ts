/**
 * Acoustic Layer Store
 *
 * Tracks which Speckle layer(s) have been designated as the acoustic simulation
 * layer. This is the single source of truth — replacing auto-detect logic in useSpeckleSurfaceMaterials.
 *
 * Supports MULTI-select: a user can designate several layers AND/OR individual
 * child objects as the acoustic region. The primary node (first selected) is
 * exposed via the legacy singular fields for consumers that assume one layer
 * (material assignment); isolation + simulation use the resolved geometry union.
 *
 * Model-bound domain state: saved in the model's soundscape.json (`acoustic_region`,
 * via `getAcousticSelectionForSave` / `restoreAcousticSelection`), NOT localStorage —
 * every model open/refresh resets the domain first, which would wipe a local copy
 * before it rehydrates. Undoable: the user's region selection is an
 * edit (it changes what gets simulated). Auto-detection / persisted-selection
 * validation are loads (runAsLoad) and resolved geometry ids are derived — none
 * of those create a step. A whole Re-assign flow (clear → pick → confirm or
 * cancel) is ONE step via the capture/restore/discard snapshot helpers.
 *
 * Producers : ObjectExplorer checkbox selection, useAcousticLayerIsolation auto-detect
 * Consumers : ObjectExplorer (tree filtering), useAcousticLayerIsolation (isolation effect),
 *             useSpeckleSurfaceMaterials (selectedLayerId)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { temporal } from 'zundo';
import {
  UNDO_HISTORY_LIMIT,
  undoEquality,
  pauseStore,
  commitStore,
  runAsLoad,
  type RegisterTemporalStoreOptions,
} from './undoRedoRegistry';
import { getAcousticLayerAllIds } from './speckleStore';
import type { SimulationAcousticSelection } from '@/types/acoustics';

const initialState = {
  /** Legacy singular fields — always mirror the FIRST selected node (or null). */
  selectedAcousticLayerId: null as string | null,
  selectedAcousticLayerName: null as string | null,
  /**
   * The user's raw selection: tree-node ids (layers AND/OR individual child
   * objects) chosen as the acoustic region. Primary first.
   */
  selectedAcousticLayerIds: [] as string[],
  selectedAcousticLayerNames: [] as string[],
  /**
   * Resolved geometry leaf union for the current selection. Computed and
   * published by `useAcousticLayerIsolation` (supports leaf/custom picks that
   * cannot be described by a single layer name). Reactive mirror of the
   * module-level `_acousticLayerAllIds` in speckleStore.
   */
  selectedAcousticGeometryIds: [] as string[],
  /** Total mesh faces (triangulated) across the resolved acoustic geometry union. */
  selectedAcousticFaceCount: 0,
  /** When the selected layer is the model root, isolation is skipped (all objects are the acoustic layer). */
  isWholeModel: false,
  /** True when the current selection was auto-detected (layer named "Acoustics" / single-layer model). */
  autoDetected: false,
  /**
   * Per-geometry-id mesh triangle counts, computed from the viewer's BVH
   * (raw Speckle `faces` arrays are emptied during tree build). Keyed by
   * geometry object id. Non-persisted, model-bound.
   */
  modelFaceCounts: {} as Record<string, number>,
};

export type AcousticLayerState = typeof initialState;

/** Payload for a full acoustic selection commit (manual picks or auto-detect). */
export interface AcousticSelectionPayload {
  /** Selected tree-node ids — layers and/or leaf objects (primary first). */
  nodeIds: string[];
  /** Display names, parallel to `nodeIds`. */
  nodeNames: string[];
  /** Resolved geometry leaf ids for the selection (optional; the isolation effect recomputes). */
  geometryIds?: string[];
  /** Total mesh faces across the selection (optional; the isolation effect recomputes). */
  faceCount?: number;
  isWholeModel?: boolean;
  autoDetected?: boolean;
}

interface AcousticLayerActions {
  setAcousticLayer: (id: string, name: string, wholeModel?: boolean) => void;
  /** Set the full multi-select list (primary = first entry). */
  setAcousticLayers: (ids: string[], names: string[], wholeModel?: boolean) => void;
  /** Commit a full acoustic selection (manual checkbox picks or auto-detect). */
  setAcousticSelection: (payload: AcousticSelectionPayload) => void;
  /** Internal: publish the resolved geometry leaf union (called by useAcousticLayerIsolation). */
  setResolvedAcousticGeometryIds: (ids: string[], faceCount?: number) => void;
  /** Internal: publish per-geometry-id mesh triangle counts (viewer BVH). */
  setModelFaceCounts: (counts: Record<string, number>) => void;
  /** Toggle a layer in the selection set; returns the new id list. */
  toggleAcousticLayer: (id: string, name: string) => void;
  clearAcousticLayer: () => void;
}

type AcousticLayerStoreState = AcousticLayerState & AcousticLayerActions;

// The selection (and the geometry it resolved to, restored as a coherent pair).
// Derived geometry ids / face counts never create a step on their own.
export const acousticLayerPartialize = (state: AcousticLayerStoreState) => ({
  selectedAcousticLayerId: state.selectedAcousticLayerId,
  selectedAcousticLayerName: state.selectedAcousticLayerName,
  selectedAcousticLayerIds: state.selectedAcousticLayerIds,
  selectedAcousticLayerNames: state.selectedAcousticLayerNames,
  selectedAcousticGeometryIds: state.selectedAcousticGeometryIds,
  selectedAcousticFaceCount: state.selectedAcousticFaceCount,
  isWholeModel: state.isWholeModel,
  autoDetected: state.autoDetected,
});

type AcousticLayerSnapshot = ReturnType<typeof acousticLayerPartialize>;

const acousticLayerEquality = (a: AcousticLayerSnapshot, b: AcousticLayerSnapshot): boolean => {
  const { selectedAcousticGeometryIds: _ga, selectedAcousticFaceCount: _fa, ...restA } = a;
  const { selectedAcousticGeometryIds: _gb, selectedAcousticFaceCount: _fb, ...restB } = b;
  return undoEquality(restA, restB);
};

export const acousticLayerUndo: RegisterTemporalStoreOptions<AcousticLayerStoreState, AcousticLayerSnapshot> = {
  partialize: acousticLayerPartialize,
  equality: acousticLayerEquality,
};

export const useAcousticLayerStore = create<AcousticLayerStoreState>()(
    temporal(
    devtools(
      (set) => ({
        ...initialState,
        setAcousticLayer: (id, name, wholeModel = false) =>
          set(
            {
              selectedAcousticLayerId: id,
              selectedAcousticLayerName: name,
              selectedAcousticLayerIds: [id],
              selectedAcousticLayerNames: [name],
              isWholeModel: wholeModel,
              autoDetected: true,
            },
            false,
            'acousticLayer/setAcousticLayer',
          ),
        setAcousticLayers: (ids, names, wholeModel = false) =>
          set(
            {
              selectedAcousticLayerId: ids.length > 0 ? ids[0] : null,
              selectedAcousticLayerName: names.length > 0 ? names[0] : null,
              selectedAcousticLayerIds: ids,
              selectedAcousticLayerNames: names,
              isWholeModel: wholeModel,
            },
            false,
            'acousticLayer/setAcousticLayers',
          ),
        setAcousticSelection: ({ nodeIds, nodeNames, geometryIds, faceCount = 0, isWholeModel = false, autoDetected = false }) =>
          set(
            {
              selectedAcousticLayerId: nodeIds.length > 0 ? nodeIds[0] : null,
              selectedAcousticLayerName: nodeNames.length > 0 ? nodeNames[0] : null,
              selectedAcousticLayerIds: nodeIds,
              selectedAcousticLayerNames: nodeNames,
              selectedAcousticGeometryIds: geometryIds ?? [],
              selectedAcousticFaceCount: faceCount,
              isWholeModel,
              autoDetected,
            },
            false,
            'acousticLayer/setAcousticSelection',
          ),
        setResolvedAcousticGeometryIds: (ids, faceCount = 0) =>
          set(
            { selectedAcousticGeometryIds: ids, selectedAcousticFaceCount: faceCount },
            false,
            'acousticLayer/setResolvedAcousticGeometryIds',
          ),
        setModelFaceCounts: (counts) =>
          set(
            { modelFaceCounts: counts },
            false,
            'acousticLayer/setModelFaceCounts',
          ),
        toggleAcousticLayer: (id, name) => {
          const s = useAcousticLayerStore.getState();
          const ids = [...s.selectedAcousticLayerIds];
          const names = [...s.selectedAcousticLayerNames];
          const idx = ids.indexOf(id);
          if (idx >= 0) {
            ids.splice(idx, 1);
            names.splice(idx, 1);
          } else {
            ids.push(id);
            names.push(name);
          }
          set(
            {
              selectedAcousticLayerId: ids.length > 0 ? ids[0] : null,
              selectedAcousticLayerName: names.length > 0 ? names[0] : null,
              selectedAcousticLayerIds: ids,
              selectedAcousticLayerNames: names,
            },
            false,
            'acousticLayer/toggleAcousticLayer',
          );
        },
        clearAcousticLayer: () =>
          // Reset the SELECTION only — keep `modelFaceCounts` (model-bound geometry
          // metadata computed once from the viewer BVH). Wiping it here left
          // re-assign / re-detected regions with 0 faces.
          set(
            {
              selectedAcousticLayerId: null,
              selectedAcousticLayerName: null,
              selectedAcousticLayerIds: [],
              selectedAcousticLayerNames: [],
              selectedAcousticGeometryIds: [],
              selectedAcousticFaceCount: 0,
              isWholeModel: false,
              autoDetected: false,
            },
            false,
            'acousticLayer/clearAcousticLayer',
          ),
      }),
      { name: 'acousticLayerStore' },
    ),
      { partialize: acousticLayerPartialize, equality: acousticLayerEquality, limit: UNDO_HISTORY_LIMIT },
    ),
);

/**
 * Transient snapshot of the acoustic selection, captured right before a
 * re-assign clears the current region so a cancel can restore it. Module-level
 * (not store state): it is transient and must never be persisted or recorded in
 * undo history.
 */
let _reassignSnapshot: AcousticSelectionPayload | null = null;

/** The current selection as a payload, or null when no region is assigned. */
function readAcousticSelection(): AcousticSelectionPayload | null {
  const s = useAcousticLayerStore.getState();
  if (s.selectedAcousticLayerIds.length === 0) return null;
  return {
    nodeIds: [...s.selectedAcousticLayerIds],
    nodeNames: [...s.selectedAcousticLayerNames],
    geometryIds: [...s.selectedAcousticGeometryIds],
    faceCount: s.selectedAcousticFaceCount,
    isWholeModel: s.isWholeModel,
    autoDetected: s.autoDetected,
  };
}

/**
 * The region to write to soundscape.json. While a re-assign is in progress the
 * live selection is temporarily cleared — save the pre-re-assign region instead
 * so a save (or refresh) mid-pick never persists an empty region.
 */
export function getAcousticSelectionForSave(): SimulationAcousticSelection | null {
  const sel = _reassignSnapshot ?? readAcousticSelection();
  if (!sel) return null;
  return {
    nodeIds: sel.nodeIds,
    nodeNames: sel.nodeNames,
    geometryIds: sel.geometryIds ?? [],
    isWholeModel: !!sel.isWholeModel,
    autoDetected: !!sel.autoDetected,
  };
}

/**
 * Apply a region loaded from soundscape.json. A load, not an edit (no undo step).
 * `null` (legacy save without a region) leaves the store untouched so
 * auto-detection / the selection prompt run as before.
 */
export function restoreAcousticSelection(sel: SimulationAcousticSelection | null): void {
  if (!sel || sel.nodeIds.length === 0) return;
  console.log('[dbg:acoustic-region] restoring saved region', sel.nodeNames);
  runAsLoad(() => useAcousticLayerStore.getState().setAcousticSelection(sel));
}

/**
 * Capture the current acoustic selection before it is cleared by a re-assign.
 * Call this immediately before `clearAcousticLayer()`. A no-op region (nothing
 * assigned) leaves the snapshot null so Cancel simply aborts.
 */
export function captureAcousticSelectionSnapshot(): void {
  // The whole re-assign (clear → pick → confirm / cancel) records as ONE undo
  // step from the pre-re-assign region; a cancel records nothing.
  pauseStore('acousticLayer', { spanInteractions: true });
  _reassignSnapshot = readAcousticSelection();
}

/**
 * Restore the pre-re-assign selection. Returns true when a previous region
 * existed and was restored; false when there was nothing to return to (abort).
 */
export function restoreAcousticSelectionSnapshot(): boolean {
  const snap = _reassignSnapshot;
  _reassignSnapshot = null;
  if (snap) useAcousticLayerStore.getState().setAcousticSelection(snap);
  commitStore('acousticLayer');
  return !!snap;
}

/** Drop the snapshot after a re-assign is confirmed (no restore). */
export function discardAcousticSelectionSnapshot(): void {
  _reassignSnapshot = null;
  commitStore('acousticLayer');
}

/**
 * Resolve the layer name to send to the backend simulation routers.
 *
 * When the acoustic layer is the whole model (single-layer model), return an empty
 * string so the backend skips layer-name filtering entirely
 * (speckle_service.get_model_geometry skips filtering on a falsy layer_name).
 *
 * When MULTIPLE nodes are selected, OR the selection is a precise geometry-id
 * set (leaf/custom picks that cannot be described by one layer name), return ''
 * so the backend relies on the explicit geometry object ids instead
 * (see resolveSimulationGeometryObjectIds).
 */
export function resolveSimulationLayerName(layerName: string | null | undefined): string {
  const s = useAcousticLayerStore.getState();
  if (s.isWholeModel) return '';
  if (s.selectedAcousticLayerIds.length > 1) return '';
  if (s.selectedAcousticGeometryIds.length > 0) return '';
  return layerName || '';
}

/**
 * Resolve the explicit geometry object ids to send to the backend simulation
 * routers. This is the union of geometry leaf ids across all selected acoustic
 * layers (computed by useAcousticLayerIsolation and published via
 * setAcousticLayerAllIds). Passing these lets the backend skip layer-name
 * filtering and run on the exact selected geometry — which is what enables
 * multi-layer acoustic selection to reach the simulation.
 */
export function resolveSimulationGeometryObjectIds(): string[] {
  return toBackendGeometryIds(getAcousticLayerAllIds());
}

/**
 * Translate viewer geometry ids to the raw Speckle object hashes the backend
 * simulation routers filter on.
 *
 * The viewer disambiguates duplicate-id nodes by suffixing `model.id` with
 * `#<n>`. The backend keys geometry by the RAW Speckle hash (`obj.id`), so the
 * suffix must be stripped. Duplicates collapse to one hash here — the backend
 * cannot separate same-hash copies anyway.
 */
export function toBackendGeometryIds(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    const hash = id.indexOf('#') === -1 ? id : id.slice(0, id.indexOf('#'));
    if (hash) out.add(hash);
  }
  return Array.from(out);
}

