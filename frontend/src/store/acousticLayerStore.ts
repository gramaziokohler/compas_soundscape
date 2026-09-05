/**
 * Acoustic Layer Store
 *
 * Tracks which Speckle layer(s) have been designated as the acoustic simulation
 * layer. This is the single source of truth — replacing auto-detect logic in useSpeckleSurfaceMaterials.
 *
 * Supports MULTI-select: a user can designate several layers/objects as the
 * acoustic layer(s). The primary layer (first selected) is exposed via the
 * legacy singular fields for consumers that assume one layer (material
 * assignment); the isolation + simulation use the full list.
 *
 * Persisted for refresh survival. Non-temporal (configuration, not user-drawing state).
 *
 * Producers : ObjectExplorer "Select" button, useAcousticLayerIsolation auto-detect
 * Consumers : ObjectExplorer (tree filtering), useAcousticLayerIsolation (isolation effect),
 *             useSpeckleSurfaceMaterials (selectedLayerId)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { devtools } from 'zustand/middleware';
import { getAcousticLayerAllIds } from './speckleStore';

const initialState = {
  /** Legacy singular fields — always mirror the FIRST selected layer (or null). */
  selectedAcousticLayerId: null as string | null,
  selectedAcousticLayerName: null as string | null,
  /** All selected acoustic layer ids (primary first). */
  selectedAcousticLayerIds: [] as string[],
  selectedAcousticLayerNames: [] as string[],
  /** When the selected layer is the model root, isolation is skipped (all objects are the acoustic layer). */
  isWholeModel: false,
};

export type AcousticLayerState = typeof initialState;

interface AcousticLayerActions {
  setAcousticLayer: (id: string, name: string, wholeModel?: boolean) => void;
  /** Set the full multi-select list (primary = first entry). */
  setAcousticLayers: (ids: string[], names: string[], wholeModel?: boolean) => void;
  /** Toggle a layer in the selection set; returns the new id list. */
  toggleAcousticLayer: (id: string, name: string) => void;
  clearAcousticLayer: () => void;
}

export const useAcousticLayerStore = create<AcousticLayerState & AcousticLayerActions>()(
  devtools(
    persist(
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
          set(initialState, false, 'acousticLayer/clearAcousticLayer'),
      }),
      {
        name: 'compas-acoustic-layer',
        storage: createJSONStorage(() => localStorage),
        skipHydration: true,
        partialize: (state) => ({
          selectedAcousticLayerId: state.selectedAcousticLayerId,
          selectedAcousticLayerName: state.selectedAcousticLayerName,
          selectedAcousticLayerIds: state.selectedAcousticLayerIds,
          selectedAcousticLayerNames: state.selectedAcousticLayerNames,
          isWholeModel: state.isWholeModel,
        }),
      },
    ),
    { name: 'acousticLayerStore' },
  ),
);

/**
 * Resolve the layer name to send to the backend simulation routers.
 *
 * When the acoustic layer is the whole model (single-layer model), return an empty
 * string so the backend skips layer-name filtering entirely
 * (speckle_service.get_model_geometry skips filtering on a falsy layer_name).
 *
 * When MULTIPLE layers are selected, return '' so the backend relies on the
 * explicit geometry object ids instead (see resolveSimulationGeometryObjectIds).
 */
export function resolveSimulationLayerName(layerName: string | null | undefined): string {
  const s = useAcousticLayerStore.getState();
  if (s.isWholeModel) return '';
  if (s.selectedAcousticLayerIds.length > 1) return '';
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
  return getAcousticLayerAllIds();
}

