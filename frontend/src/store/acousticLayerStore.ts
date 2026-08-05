/**
 * Acoustic Layer Store
 *
 * Tracks which Speckle layer has been designated as the acoustic simulation layer.
 * This is the single source of truth — replacing auto-detect logic in useSpeckleSurfaceMaterials.
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

const initialState = {
  selectedAcousticLayerId: null as string | null,
  selectedAcousticLayerName: null as string | null,
  /** When the selected layer is the model root, isolation is skipped (all objects are the acoustic layer). */
  isWholeModel: false,
};

export type AcousticLayerState = typeof initialState;

interface AcousticLayerActions {
  setAcousticLayer: (id: string, name: string, wholeModel?: boolean) => void;
  clearAcousticLayer: () => void;
}

export const useAcousticLayerStore = create<AcousticLayerState & AcousticLayerActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        setAcousticLayer: (id, name, wholeModel = false) =>
          set(
            { selectedAcousticLayerId: id, selectedAcousticLayerName: name, isWholeModel: wholeModel },
            false,
            'acousticLayer/setAcousticLayer',
          ),
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
 */
export function resolveSimulationLayerName(layerName: string | null | undefined): string {
  if (useAcousticLayerStore.getState().isWholeModel) return '';
  return layerName || '';
}
