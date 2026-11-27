/**
 * Grid Listeners Store
 *
 * Manages grid listener configurations with zundo temporal support.
 * Grid listeners define a 2D grid of receiver points distributed evenly
 * over selected Speckle surfaces, or inside a polygon drawn on the model.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import { computeGridPoints } from '@/lib/three/grid-listener-geometry';
import {
  duplicateItemAt,
  moveItem,
  surfaceGridId,
  withSurfaceArea,
  withSurfaceBounds,
  withSurfaceUpdates,
} from '@/utils/surfaceGrid';
import type { GridListenerData } from '@/types/receiver';
import type { DrawnArea } from '@/types/area-drawing';
import { UNDO_HISTORY_LIMIT, undoEquality, type RegisterTemporalStoreOptions } from './undoRedoRegistry';

// ─── Grid computation ─────────────────────────────────────────────────────────

export { computeGridPoints };

const GRID_ID_PREFIX = 'grid-listener-';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const gridListenersPartialize = (state: GridListenersStoreState) => ({
  gridListeners: state.gridListeners,
});

export const gridListenersUndo: RegisterTemporalStoreOptions<
  GridListenersStoreState,
  ReturnType<typeof gridListenersPartialize>
> = { partialize: gridListenersPartialize };

// ─── State ────────────────────────────────────────────────────────────────────

export interface GridListenersStoreState {
  gridListeners: GridListenerData[];

  addGridListener: () => string;
  removeGridListener: (id: string) => void;
  reorderGridListeners: (from: number, to: number) => void;
  /** Ctrl+drag duplicate — deep-clones the grid listener at `from` and inserts at `toInsertion`. */
  duplicateGridListenerAt: (from: number, toInsertion: number) => void;
  /**
   * Update fields on a grid listener.
   * When xSpacing / ySpacing / zOffset change and a bounding box exists,
   * points are recomputed atomically in the same state update (for real-time 3D sync).
   */
  updateGridListener: (id: string, updates: Partial<Omit<GridListenerData, 'id'>>) => void;
  setGridListenerBounds: (
    id: string,
    objectIds: string[],
    bbox: { min: [number, number, number]; max: [number, number, number] },
  ) => void;
  /** Use a drawn polygon as the grid boundary (points are clipped to it). */
  setGridListenerArea: (id: string, area: DrawnArea) => void;
  toggleGridListenerHiddenForSimulation: (id: string) => void;
  /** Show the `shownIds` grids for simulation and hide every other one (ids of other kinds are ignored). */
  showOnlyGridListenersForSimulation: (shownIds: ReadonlySet<string>) => void;

  /** Restore grid listener configurations from a saved soundscape (bulk replace). */
  restoreGridListeners: (savedGridListeners: GridListenerData[]) => void;

  /** All active (non-hidden) grid listener points for simulation */
  getEffectiveGridPoints: () => [number, number, number][];
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGridListenersStore = create<GridListenersStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        gridListeners: [],

        addGridListener: () => {
          const id = surfaceGridId(GRID_ID_PREFIX);
          const count = get().gridListeners.length + 1;
          const newGrid: GridListenerData = {
            id,
            name: `Grid ${count}`,
            xSpacing: GRID_LISTENER_CONFIG.DEFAULT_X_SPACING,
            ySpacing: GRID_LISTENER_CONFIG.DEFAULT_Y_SPACING,
            zOffset: GRID_LISTENER_CONFIG.DEFAULT_Z_OFFSET,
            showListeners: true,
            hiddenForSimulation: false,
            selectedObjectIds: [],
            boundingBox: null,
            points: [],
            placementMode: 'objects',
            drawnArea: null,
          };
          set(
            (s) => ({ gridListeners: [...s.gridListeners, newGrid] }),
            false,
            'gridListeners/add',
          );
          return id;
        },

        removeGridListener: (id) =>
          set(
            (s) => ({ gridListeners: s.gridListeners.filter((g) => g.id !== id) }),
            false,
            'gridListeners/remove',
          ),

        reorderGridListeners: (from, to) =>
          set(
            (s) => ({ gridListeners: moveItem(s.gridListeners, from, to) }),
            false,
            'gridListeners/reorder',
          ),

        duplicateGridListenerAt: (from, toInsertion) =>
          set(
            (s) => {
              const next = duplicateItemAt(s.gridListeners, from, toInsertion, surfaceGridId(GRID_ID_PREFIX));
              return next ? { gridListeners: next } : {};
            },
            false,
            'gridListeners/duplicateAt',
          ),

        updateGridListener: (id, updates) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => (g.id === id ? withSurfaceUpdates(g, updates) : g)),
            }),
            false,
            'gridListeners/update',
          ),

        setGridListenerBounds: (id, objectIds, bbox) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => (g.id === id ? withSurfaceBounds(g, objectIds, bbox) : g)),
            }),
            false,
            'gridListeners/setBounds',
          ),

        setGridListenerArea: (id, area) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => (g.id === id ? withSurfaceArea(g, area) : g)),
            }),
            false,
            'gridListeners/setArea',
          ),

        showOnlyGridListenersForSimulation: (shownIds) => {
          const { gridListeners } = get();
          // Replace only the grids whose flag changes, and skip a no-op write.
          if (gridListeners.every((g) => g.hiddenForSimulation === !shownIds.has(g.id))) return;
          set(
            {
              gridListeners: gridListeners.map((g) =>
                g.hiddenForSimulation === !shownIds.has(g.id) ? g : { ...g, hiddenForSimulation: !shownIds.has(g.id) },
              ),
            },
            false,
            'gridListeners/showOnlyForSimulation',
          );
        },

        toggleGridListenerHiddenForSimulation: (id) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) =>
                g.id === id ? { ...g, hiddenForSimulation: !g.hiddenForSimulation } : g,
              ),
            }),
            false,
            'gridListeners/toggleHidden',
          ),

        restoreGridListeners: (savedGridListeners) =>
          set(
            { gridListeners: savedGridListeners },
            false,
            'gridListeners/restore',
          ),

        getEffectiveGridPoints: () => {
          const { gridListeners } = get();
          const pts: [number, number, number][] = [];
          for (const g of gridListeners) {
            if (!g.hiddenForSimulation) pts.push(...g.points);
          }
          return pts;
        },
      }),
      { name: 'gridListenersStore' },
    ),
    { partialize: gridListenersPartialize, equality: undoEquality, limit: UNDO_HISTORY_LIMIT },
  ),
);
