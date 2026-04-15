/**
 * Acoustic Material Store
 *
 * Replaces AcousticMaterialContext. Ownes all material/scattering assignment
 * state and actions globally.
 *
 * zundo partializes on materialAssignments + scatteringAssignments so that
 * undo / redo reflects assignment changes only (not structural/layer data).
 *
 * Producer : SpeckleSurfaceMaterialsSection (calls setLayerData / deactivate)
 * Consumers: EntityInfoPanel, ObjectExplorer (read state, call actions)
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type { AcousticMaterial } from '@/types/materials';
import type { HierarchicalMeshObject } from '@/hooks/useSpeckleSurfaceMaterials';
import type { SpeckleLayerInfo } from '@/types/speckle-materials';
import { getMaterialColorByAbsorption, MATERIAL_DEFAULT_COLOR } from '@/utils/constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectAllObjectIds(objects: HierarchicalMeshObject[]): string[] {
  const ids: string[] = [];
  for (const obj of objects) {
    if (obj.hasGeometry) ids.push(obj.id);
    ids.push(...collectAllObjectIds(obj.children));
  }
  return ids;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface LayerData {
  meshObjects: HierarchicalMeshObject[];
  availableMaterials: AcousticMaterial[];
  selectedLayerId: string | null;
  layerOptions: SpeckleLayerInfo[];
}

export interface AcousticMaterialStoreState {
  // ── Cross-component data (synced by SpeckleSurfaceMaterialsSection) ──
  isActive: boolean;
  meshObjects: HierarchicalMeshObject[];
  /** objectId → materialId  ← undo/redo target */
  materialAssignments: Map<string, string>;
  /** objectId → scattering  ← undo/redo target */
  scatteringAssignments: Map<string, number>;
  availableMaterials: AcousticMaterial[];
  selectedLayerId: string | null;
  layerOptions: SpeckleLayerInfo[];
  /** Layer the ObjectExplorer should auto-expand to */
  expandToLayerId: string | null;

  // ── Lifecycle ──
  setLayerData: (data: LayerData) => void;
  deactivate: () => void;
  /** Clears viewer/layer state but preserves material + scattering assignments. */
  deactivateViewer: () => void;
  clearAssignments: () => void;

  /**
   * Load persisted assignments (initial state from a saved simulation config).
   * Call `useAcousticMaterialStore.temporal.getState().clear()` immediately after
   * to keep the initial load out of undo history.
   */
  loadAssignments: (
    materialAssignments: Map<string, string>,
    scatteringAssignments: Map<string, number>,
  ) => void;

  // ── Material assignment actions ──
  assignMaterial: (objectId: string, materialId: string) => void;
  assignMaterialToAll: (materialId: string) => void;
  assignMaterialToObjects: (objectIds: string[], materialId: string) => void;

  // ── Scattering assignment actions ──
  assignScattering: (objectId: string, value: number) => void;
  assignScatteringToAll: (value: number) => void;
  assignScatteringToObjects: (objectIds: string[], value: number) => void;

  // ── Helper ──
  getMaterialColor: (materialId: string) => string;
}

// ─── Partialize (exported for snapshot registry) ────────────────────────────

export const acousticMaterialPartialize = (state: AcousticMaterialStoreState) => ({
  materialAssignments: new Map(state.materialAssignments),
  scatteringAssignments: new Map(state.scatteringAssignments),
});

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAcousticMaterialStore = create<AcousticMaterialStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        // ── Initial state ──
        isActive: false,
        meshObjects: [],
        materialAssignments: new Map(),
        scatteringAssignments: new Map(),
        availableMaterials: [],
        selectedLayerId: null,
        layerOptions: [],
        expandToLayerId: null,

        // ── Lifecycle ──
        setLayerData: (data) =>
          set(
            {
              isActive: true,
              meshObjects: data.meshObjects,
              availableMaterials: data.availableMaterials,
              selectedLayerId: data.selectedLayerId,
              layerOptions: data.layerOptions,
              expandToLayerId: data.selectedLayerId,
            },
            false,
            'acoustic/setLayerData',
          ),

        deactivate: () =>
          set(
            {
              isActive: false,
              meshObjects: [],
              materialAssignments: new Map(),
              scatteringAssignments: new Map(),
              availableMaterials: [],
              selectedLayerId: null,
              layerOptions: [],
              expandToLayerId: null,
            },
            false,
            'acoustic/deactivate',
          ),

        deactivateViewer: () =>
          set(
            {
              isActive: false,
              meshObjects: [],
              availableMaterials: [],
              selectedLayerId: null,
              layerOptions: [],
              expandToLayerId: null,
              // materialAssignments + scatteringAssignments preserved
            },
            false,
            'acoustic/deactivateViewer',
          ),

        clearAssignments: () =>
          set(
            { materialAssignments: new Map(), scatteringAssignments: new Map() },
            false,
            'acoustic/clearAssignments',
          ),

        loadAssignments: (materialAssignments, scatteringAssignments) =>
          set(
            {
              materialAssignments: new Map(materialAssignments),
              scatteringAssignments: new Map(scatteringAssignments),
            },
            false,
            'acoustic/loadAssignments',
          ),

        // ── Material assignment actions ──
        assignMaterial: (objectId, materialId) =>
          set(
            (state) => {
              const next = new Map(state.materialAssignments);
              materialId ? next.set(objectId, materialId) : next.delete(objectId);
              return { materialAssignments: next };
            },
            false,
            'acoustic/assignMaterial',
          ),

        assignMaterialToAll: (materialId) =>
          set(
            (state) => {
              const allIds = collectAllObjectIds(state.meshObjects);
              const next = new Map(state.materialAssignments);
              allIds.forEach((id) =>
                materialId ? next.set(id, materialId) : next.delete(id),
              );
              return { materialAssignments: next };
            },
            false,
            'acoustic/assignMaterialToAll',
          ),

        assignMaterialToObjects: (objectIds, materialId) =>
          set(
            (state) => {
              const next = new Map(state.materialAssignments);
              objectIds.forEach((id) =>
                materialId ? next.set(id, materialId) : next.delete(id),
              );
              return { materialAssignments: next };
            },
            false,
            'acoustic/assignMaterialToObjects',
          ),

        // ── Scattering assignment actions ──
        assignScattering: (objectId, value) =>
          set(
            (state) => {
              const next = new Map(state.scatteringAssignments);
              next.set(objectId, value);
              return { scatteringAssignments: next };
            },
            false,
            'acoustic/assignScattering',
          ),

        assignScatteringToAll: (value) =>
          set(
            (state) => {
              const allIds = collectAllObjectIds(state.meshObjects);
              const next = new Map<string, number>();
              allIds.forEach((id) => next.set(id, value));
              return { scatteringAssignments: next };
            },
            false,
            'acoustic/assignScatteringToAll',
          ),

        assignScatteringToObjects: (objectIds, value) =>
          set(
            (state) => {
              const next = new Map(state.scatteringAssignments);
              objectIds.forEach((id) => next.set(id, value));
              return { scatteringAssignments: next };
            },
            false,
            'acoustic/assignScatteringToObjects',
          ),

        // ── Helper ──
        getMaterialColor: (materialId) => {
          const material = get().availableMaterials.find((m) => m.id === materialId);
          if (!material) return MATERIAL_DEFAULT_COLOR;
          return getMaterialColorByAbsorption(material.absorption);
        },
      }),
      { name: 'AcousticMaterialStore' },
    ),
    {
      // Snapshot only assignment Maps — exclude structural/layer data from history
      partialize: acousticMaterialPartialize,
      // Skip recording a history entry when Maps haven't changed
      equality: (past, current) => {
        if (past.materialAssignments.size !== current.materialAssignments.size) return false;
        for (const [k, v] of past.materialAssignments) {
          if (current.materialAssignments.get(k) !== v) return false;
        }
        if (past.scatteringAssignments.size !== current.scatteringAssignments.size) return false;
        for (const [k, v] of past.scatteringAssignments) {
          if (current.scatteringAssignments.get(k) !== v) return false;
        }
        return true;
      },
    },
  ),
);
