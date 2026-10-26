/**
 * PFFDTD Free-Positioning Store
 *
 * Transient state of free positioning on the wave-based card: the candidate
 * grid of each completed free-positioning run (results JSON `free` block +
 * the points binary), the IR-request status of each moved free object, and
 * whether the grid overlay is shown per card. Not persisted, not undoable:
 * the grid is re-fetched from the backend, the swapped IRs live in the card's
 * `sourceReceiverIRMapping` / `simulationPositions` (persisted with the card).
 * The debounce timers and AbortControllers live in hooks/usePffdtdFreeMovement.ts.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import type { PffdtdFreeBlock, PffdtdFreeGridPoints, PffdtdFreeIRFailure } from '@/types/pffdtd';

export interface PffdtdFreeGridEntry {
  /** 'none' = the run has no free positioning. */
  status: 'loading' | 'ready' | 'none' | 'expired' | 'error';
  block: PffdtdFreeBlock | null;
  points: PffdtdFreeGridPoints | null;
  error?: string;
}

export interface PffdtdFreeObjectStatus {
  state: 'pending' | 'ready' | PffdtdFreeIRFailure;
  /** Display name of the moved object(s). */
  label: string;
  message?: string;
  /** Grid point whose IR is playing (viewer frame). */
  snappedPosition?: [number, number, number];
  distanceM?: number;
}

interface PffdtdFreeState {
  /** Per completed simulation id. */
  grids: Record<string, PffdtdFreeGridEntry>;
  /** Per simulation id → moved object id (receiver id, or sound id in free-source mode). */
  objects: Record<string, Record<string, PffdtdFreeObjectStatus>>;
  /** Grid overlay visibility per card id. */
  showGrid: Record<string, boolean>;

  loadGrid: (simulationId: string) => Promise<void>;
  setObjectStatus: (simulationId: string, objectId: string, status: PffdtdFreeObjectStatus | null) => void;
  setShowGrid: (configId: string, show: boolean) => void;
}

export const usePffdtdFreeStore = create<PffdtdFreeState>()(
  devtools(
    (set, get) => ({
      grids: {},
      objects: {},
      showGrid: {},

      loadGrid: async (simulationId) => {
        const existing = get().grids[simulationId];
        if (existing && existing.status !== 'error') return;
        const put = (entry: PffdtdFreeGridEntry) =>
          set((s) => ({ grids: { ...s.grids, [simulationId]: entry } }), false, 'pffdtdFree/grid');
        put({ status: 'loading', block: null, points: null });
        try {
          const results = await apiService.getPffdtdResults(simulationId);
          const block = results?.free ?? null;
          if (!results) return put({ status: 'expired', block: null, points: null });
          if (!block) return put({ status: 'none', block: null, points: null });
          const points = await apiService.getPffdtdFreeGridPoints(simulationId);
          put(points ? { status: 'ready', block, points } : { status: 'expired', block, points: null });
        } catch (err) {
          put({ status: 'error', block: null, points: null, error: err instanceof Error ? err.message : String(err) });
        }
      },

      setObjectStatus: (simulationId, objectId, status) =>
        set(
          (s) => {
            const forSim = { ...(s.objects[simulationId] ?? {}) };
            if (status) forSim[objectId] = status;
            else delete forSim[objectId];
            return { objects: { ...s.objects, [simulationId]: forSim } };
          },
          false,
          'pffdtdFree/objectStatus',
        ),

      setShowGrid: (configId, show) =>
        set((s) => ({ showGrid: { ...s.showGrid, [configId]: show } }), false, 'pffdtdFree/showGrid'),
    }),
    { name: 'pffdtdFreeStore' },
  ),
);
