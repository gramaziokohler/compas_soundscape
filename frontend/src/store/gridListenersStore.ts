/**
 * Grid Listeners Store
 *
 * Manages grid listener configurations with zundo temporal support.
 * Grid listeners define a 2D grid of receiver points distributed evenly
 * over selected Speckle surfaces.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { GRID_LISTENER_CONFIG } from '@/utils/constants';
import type { GridListenerData } from '@/types/receiver';

// ─── Grid computation ─────────────────────────────────────────────────────────

/**
 * Compute a centered 2D grid of listener points from a bounding box.
 *
 * Automatically detects the surface normal (the axis with the smallest range —
 * the "thin" slab direction). The grid is placed on the two larger axes,
 * and zOffset moves points along the normal axis (regardless of whether the
 * model is Y-up or Z-up).
 */
export function computeGridPoints(
  bbox: { min: [number, number, number]; max: [number, number, number] },
  xSpacing: number,
  ySpacing: number,
  zOffset: number,
): [number, number, number][] {
  const rangesArr = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];

  // Find the axis with the smallest range — this is the surface normal (slab thickness)
  let normalAxis = 0;
  if (rangesArr[1] < rangesArr[normalAxis]) normalAxis = 1;
  if (rangesArr[2] < rangesArr[normalAxis]) normalAxis = 2;

  // The two grid axes are the other two
  const gridAxes = ([0, 1, 2] as const).filter((a) => a !== normalAxis) as [0 | 1 | 2, 0 | 1 | 2];
  const axis1 = gridAxes[0]; // maps to xSpacing
  const axis2 = gridAxes[1]; // maps to ySpacing

  // Normal position = mid of slab + zOffset (elevates the grid above the surface)
  const normalMid = (bbox.min[normalAxis] + bbox.max[normalAxis]) / 2 + zOffset;

  const range1 = rangesArr[axis1];
  const range2 = rangesArr[axis2];
  const center1 = (bbox.min[axis1] + bbox.max[axis1]) / 2;
  const center2 = (bbox.min[axis2] + bbox.max[axis2]) / 2;

  const count1 = Math.max(1, Math.floor(range1 / xSpacing) + 1);
  const count2 = Math.max(1, Math.floor(range2 / ySpacing) + 1);
  const start1 = center1 - ((count1 - 1) / 2) * xSpacing;
  const start2 = center2 - ((count2 - 1) / 2) * ySpacing;

  const points: [number, number, number][] = [];
  for (let i1 = 0; i1 < count1; i1++) {
    for (let i2 = 0; i2 < count2; i2++) {
      const pt: [number, number, number] = [0, 0, 0];
      pt[normalAxis] = normalMid;
      pt[axis1] = start1 + i1 * xSpacing;
      pt[axis2] = start2 + i2 * ySpacing;
      points.push(pt);
    }
  }
  return points;
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
  toggleGridListenerHiddenForSimulation: (id: string) => void;

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

        updateGridListener: (id, updates) =>
          set(
            (s) => ({
              gridListeners: s.gridListeners.map((g) => {
                if (g.id !== id) return g;
                const next = { ...g, ...updates };
                const spacingChanged =
                  'xSpacing' in updates || 'ySpacing' in updates || 'zOffset' in updates;
                if (spacingChanged && next.boundingBox) {
                  next.points = computeGridPoints(
                    next.boundingBox,
                    next.xSpacing,
                    next.ySpacing,
                    next.zOffset,
                  );
                }
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
                return { ...g, selectedObjectIds: objectIds, boundingBox: bbox, points };
              }),
            }),
            false,
            'gridListeners/setBounds',
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
