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
import {
  computeAreaBounds,
  computeGridPoints,
  computeGridPointsInArea,
} from '@/lib/three/grid-listener-geometry';
import type { GridListenerData } from '@/types/receiver';
import type { DrawnArea } from '@/types/area-drawing';

// ─── Grid computation ─────────────────────────────────────────────────────────

export { computeGridPoints };

/** Recompute a grid's points from its boundary (drawn area or bounding box). */
function layoutGridPoints(g: GridListenerData): [number, number, number][] {
  if (g.drawnArea) return computeGridPointsInArea(g.drawnArea, g.xSpacing, g.ySpacing, g.zOffset);
  if (g.boundingBox) return computeGridPoints(g.boundingBox, g.xSpacing, g.ySpacing, g.zOffset);
  return [];
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const gridListenersPartialize = (state: GridListenersStoreState) => ({
  gridListeners: state.gridListeners,
});

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
          const id = `grid-listener-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
            (s) => {
              const next = [...s.gridListeners];
              const [removed] = next.splice(from, 1);
              next.splice(to, 0, removed);
              return { gridListeners: next };
            },
            false,
            'gridListeners/reorder',
          ),

        duplicateGridListenerAt: (from, toInsertion) =>
          set(
            (s) => {
              const gl = s.gridListeners[from];
              if (!gl) return {};

              const cloned: GridListenerData = {
                ...structuredClone(gl),
                id: `grid-listener-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: `${gl.name} (copy)`,
              };

              const next = [...s.gridListeners];
              const insertAt = toInsertion > from ? toInsertion - 1 : toInsertion;
              next.splice(insertAt, 0, cloned);
              return { gridListeners: next };
            },
            false,
            'gridListeners/duplicateAt',
          ),

        updateGridListener: (id, updates) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => {
                if (g.id !== id) return g;
                const next = { ...g, ...updates };
                const spacingChanged =
                  'xSpacing' in updates || 'ySpacing' in updates || 'zOffset' in updates;
                if (spacingChanged) next.points = layoutGridPoints(next);
                return next;
              }),
            }),
            false,
            'gridListeners/update',
          ),

        setGridListenerBounds: (id, objectIds, bbox) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => {
                if (g.id !== id) return g;
                const points = computeGridPoints(bbox, g.xSpacing, g.ySpacing, g.zOffset);
                return {
                  ...g,
                  placementMode: 'objects',
                  drawnArea: null,
                  selectedObjectIds: objectIds,
                  boundingBox: bbox,
                  points,
                };
              }),
            }),
            false,
            'gridListeners/setBounds',
          ),

        setGridListenerArea: (id, area) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => {
                if (g.id !== id) return g;
                const next: GridListenerData = {
                  ...g,
                  placementMode: 'area',
                  drawnArea: area,
                  selectedObjectIds: [],
                  boundingBox: computeAreaBounds(area),
                };
                return { ...next, points: layoutGridPoints(next) };
              }),
            }),
            false,
            'gridListeners/setArea',
          ),

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
    { partialize: gridListenersPartialize },
  ),
);
