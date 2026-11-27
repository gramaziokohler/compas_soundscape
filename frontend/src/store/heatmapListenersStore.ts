/**
 * Heatmap Listeners Store
 *
 * Heatmap listener cards: a surface (same boundary + spacing as a grid listener)
 * mapped with compas_acoustics EnergyMap on the active simulation card.
 *
 * - `heatmapListeners` (undoable): the surfaces.
 * - `results` / `metrics` (NOT undoable, saved): the finished run of each heatmap and
 *   what it shows. Undo never discards a finished run; switching the metric is display.
 * - `runs`, `payloads`, `activeHeatmapId` (runtime): job progress, the loaded payloads,
 *   the powered heatmap (its gradient plane is drawn).
 *
 * A running job is also kept in localStorage (`compas-inflight-heatmaps`) so a page
 * refresh reattaches to it (`resumeInflightRuns`).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { GRID_LISTENER_CONFIG, HEATMAP_LISTENER_CONFIG } from '@/utils/constants';
import {
  duplicateItemAt,
  moveItem,
  surfaceGridId,
  withSurfaceArea,
  withSurfaceBounds,
  withSurfaceUpdates,
} from '@/utils/surfaceGrid';
import type { DrawnArea } from '@/types/area-drawing';
import type {
  HeatmapListenerData,
  HeatmapMetric,
  HeatmapPayload,
  HeatmapResultRef,
  HeatmapRunState,
  SavedHeatmapListener,
} from '@/types/heatmap';
import type { RunHeatmapParams } from '@/services/api';
import { UNDO_HISTORY_LIMIT, undoEquality, type RegisterTemporalStoreOptions } from './undoRedoRegistry';

type BBox = { min: [number, number, number]; max: [number, number, number] };

/** Everything of a finished run except the backend id (known once the job is done). */
export type PendingHeatmapResult = Omit<HeatmapResultRef, 'heatmapId'>;

export interface RunHeatmapArgs {
  heatmapListenerId: string;
  params: RunHeatmapParams;
  pending: PendingHeatmapResult;
}

const IDLE_RUN: HeatmapRunState = { status: 'idle', progress: 0, statusText: '', jobId: null, error: null };
const INFLIGHT_KEY = 'compas-inflight-heatmaps';

interface InflightHeatmap {
  heatmapListenerId: string;
  jobId: string;
  pending: PendingHeatmapResult;
}

function readInflight(): InflightHeatmap[] {
  try {
    const raw = localStorage.getItem(INFLIGHT_KEY);
    return raw ? (JSON.parse(raw) as InflightHeatmap[]) : [];
  } catch {
    return [];
  }
}

function writeInflight(list: InflightHeatmap[]): void {
  try {
    if (list.length) localStorage.setItem(INFLIGHT_KEY, JSON.stringify(list));
    else localStorage.removeItem(INFLIGHT_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

const pollers = new Map<string, ReturnType<typeof setInterval>>();

function stopPoller(heatmapListenerId: string): void {
  const timer = pollers.get(heatmapListenerId);
  if (timer) clearInterval(timer);
  pollers.delete(heatmapListenerId);
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const heatmapListenersPartialize = (state: HeatmapListenersStoreState) => ({
  heatmapListeners: state.heatmapListeners,
});

export const heatmapListenersUndo: RegisterTemporalStoreOptions<
  HeatmapListenersStoreState,
  ReturnType<typeof heatmapListenersPartialize>
> = { partialize: heatmapListenersPartialize };

// ─── State ────────────────────────────────────────────────────────────────────

export interface HeatmapListenersStoreState {
  heatmapListeners: HeatmapListenerData[];
  results: Record<string, HeatmapResultRef>;
  metrics: Record<string, HeatmapMetric>;
  runs: Record<string, HeatmapRunState>;
  /** Loaded payloads by backend heatmap id. */
  payloads: Record<string, HeatmapPayload>;
  /** Powered heatmap (its gradient plane is shown), or null. */
  activeHeatmapId: string | null;

  addHeatmapListener: () => string;
  removeHeatmapListener: (id: string) => void;
  reorderHeatmapListeners: (from: number, to: number) => void;
  duplicateHeatmapListenerAt: (from: number, toInsertion: number) => void;
  updateHeatmapListener: (id: string, updates: Partial<Omit<HeatmapListenerData, 'id'>>) => void;
  setHeatmapListenerBounds: (id: string, objectIds: string[], bbox: BBox) => void;
  setHeatmapListenerArea: (id: string, area: DrawnArea) => void;
  setMetric: (id: string, metric: HeatmapMetric) => void;
  setActiveHeatmap: (id: string | null) => void;

  /** Submit the EnergyMap job of a heatmap and poll it to completion. */
  runHeatmap: (args: RunHeatmapArgs) => Promise<void>;
  cancelHeatmap: (id: string) => void;
  /** Fetch a result's payload once (no-op when loaded or loading). */
  loadPayload: (heatmapId: string) => Promise<void>;
  /** Reattach to the jobs that were running before a page refresh. */
  resumeInflightRuns: () => void;

  /** Bulk replace from a saved soundscape. */
  restoreHeatmapListeners: (saved: SavedHeatmapListener[]) => void;
  /** Saved shape of every heatmap (soundscape.json `heatmap_listeners`). */
  getSavedHeatmapListeners: () => SavedHeatmapListener[];
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useHeatmapListenersStore = create<HeatmapListenersStoreState>()(
  temporal(
    devtools(
      (set, get) => {
        const patchRun = (id: string, update: Partial<HeatmapRunState>, action: string) =>
          set((s) => ({ runs: { ...s.runs, [id]: { ...(s.runs[id] ?? IDLE_RUN), ...update } } }), false, action);

        const mapHeatmaps = (id: string, fn: (h: HeatmapListenerData) => HeatmapListenerData, action: string) =>
          set((s) => ({ heatmapListeners: s.heatmapListeners.map((h) => (h.id === id ? fn(h) : h)) }), false, action);

        /** Poll a submitted job; store the result and load its payload when it finishes. */
        const poll = (heatmapListenerId: string, jobId: string, pending: PendingHeatmapResult) => {
          stopPoller(heatmapListenerId);
          const finish = (update: Partial<HeatmapRunState>, action: string) => {
            stopPoller(heatmapListenerId);
            writeInflight(readInflight().filter((j) => j.jobId !== jobId));
            patchRun(heatmapListenerId, update, action);
          };
          const timer = setInterval(async () => {
            try {
              const st = await apiService.getHeatmapStatus(jobId);
              if (st.cancelled) return finish({ status: 'idle', statusText: 'Cancelled', jobId: null }, 'heatmap/cancelled');
              if (st.error) return finish({ status: 'error', error: st.error, statusText: 'Error', jobId: null }, 'heatmap/error');
              if (!st.completed || !st.result) {
                patchRun(heatmapListenerId, { progress: st.progress, statusText: st.status }, 'heatmap/progress');
                return;
              }
              stopPoller(heatmapListenerId);
              const heatmapId = st.result.heatmap_id;
              await get().loadPayload(heatmapId);
              // The card may have been deleted while the job ran.
              if (get().heatmapListeners.some((h) => h.id === heatmapListenerId)) {
                set((s) => ({
                  results: { ...s.results, [heatmapListenerId]: { ...pending, heatmapId } },
                  activeHeatmapId: heatmapListenerId,
                }), false, 'heatmap/result');
              }
              finish({ status: 'done', progress: 100, statusText: 'Done', jobId: null }, 'heatmap/done');
            } catch (err) {
              finish({
                status: 'error',
                error: err instanceof Error ? err.message : 'Heatmap failed',
                statusText: 'Error',
                jobId: null,
              }, 'heatmap/pollError');
            }
          }, HEATMAP_LISTENER_CONFIG.JOB_POLL_MS);
          pollers.set(heatmapListenerId, timer);
        };

        const loadingPayloads = new Set<string>();

        return {
          heatmapListeners: [],
          results: {},
          metrics: {},
          runs: {},
          payloads: {},
          activeHeatmapId: null,

          addHeatmapListener: () => {
            const id = surfaceGridId(HEATMAP_LISTENER_CONFIG.ID_PREFIX);
            const heatmap: HeatmapListenerData = {
              id,
              name: `Heatmap ${get().heatmapListeners.length + 1}`,
              xSpacing: HEATMAP_LISTENER_CONFIG.DEFAULT_SPACING,
              ySpacing: HEATMAP_LISTENER_CONFIG.DEFAULT_SPACING,
              zOffset: GRID_LISTENER_CONFIG.DEFAULT_Z_OFFSET,
              showListeners: false,
              hiddenForSimulation: false, // unused: heatmaps never feed the IR simulations (not in gridListeners)
              selectedObjectIds: [],
              boundingBox: null,
              points: [],
              placementMode: 'objects',
              drawnArea: null,
            };
            set((s) => ({ heatmapListeners: [...s.heatmapListeners, heatmap] }), false, 'heatmap/add');
            return id;
          },

          removeHeatmapListener: (id) => {
            get().cancelHeatmap(id);
            set((s) => {
              const { [id]: _r, ...results } = s.results;
              const { [id]: _m, ...metrics } = s.metrics;
              const { [id]: _run, ...runs } = s.runs;
              return {
                heatmapListeners: s.heatmapListeners.filter((h) => h.id !== id),
                results,
                metrics,
                runs,
                activeHeatmapId: s.activeHeatmapId === id ? null : s.activeHeatmapId,
              };
            }, false, 'heatmap/remove');
          },

          reorderHeatmapListeners: (from, to) =>
            set((s) => ({ heatmapListeners: moveItem(s.heatmapListeners, from, to) }), false, 'heatmap/reorder'),

          duplicateHeatmapListenerAt: (from, toInsertion) =>
            set((s) => {
              const next = duplicateItemAt(
                s.heatmapListeners, from, toInsertion, surfaceGridId(HEATMAP_LISTENER_CONFIG.ID_PREFIX),
              );
              return next ? { heatmapListeners: next } : {};
            }, false, 'heatmap/duplicateAt'),

          updateHeatmapListener: (id, updates) =>
            mapHeatmaps(id, (h) => withSurfaceUpdates(h, updates), 'heatmap/update'),

          setHeatmapListenerBounds: (id, objectIds, bbox) =>
            mapHeatmaps(id, (h) => withSurfaceBounds(h, objectIds, bbox), 'heatmap/setBounds'),

          setHeatmapListenerArea: (id, area) =>
            mapHeatmaps(id, (h) => withSurfaceArea(h, area), 'heatmap/setArea'),

          setMetric: (id, metric) =>
            set((s) => ({ metrics: { ...s.metrics, [id]: metric } }), false, 'heatmap/metric'),

          setActiveHeatmap: (id) => set({ activeHeatmapId: id }, false, 'heatmap/setActive'),

          runHeatmap: async ({ heatmapListenerId, params, pending }) => {
            get().cancelHeatmap(heatmapListenerId);
            patchRun(heatmapListenerId, { ...IDLE_RUN, status: 'running', statusText: 'Submitting...' }, 'heatmap/start');
            try {
              const { job_id } = await apiService.runHeatmap(params);
              patchRun(heatmapListenerId, { jobId: job_id, statusText: 'Queued...' }, 'heatmap/queued');
              writeInflight([
                ...readInflight().filter((j) => j.heatmapListenerId !== heatmapListenerId),
                { heatmapListenerId, jobId: job_id, pending },
              ]);
              poll(heatmapListenerId, job_id, pending);
            } catch (err) {
              patchRun(heatmapListenerId, {
                status: 'error',
                error: err instanceof Error ? err.message : 'Heatmap failed',
                statusText: 'Error',
              }, 'heatmap/submitError');
            }
          },

          cancelHeatmap: (id) => {
            stopPoller(id);
            const jobId = get().runs[id]?.jobId;
            if (!jobId) return;
            apiService.cancelHeatmap(jobId).catch(console.warn);
            writeInflight(readInflight().filter((j) => j.jobId !== jobId));
            patchRun(id, { status: 'idle', statusText: 'Cancelled', jobId: null }, 'heatmap/cancel');
          },

          loadPayload: async (heatmapId) => {
            if (get().payloads[heatmapId] || loadingPayloads.has(heatmapId)) return;
            loadingPayloads.add(heatmapId);
            try {
              const payload = await apiService.getHeatmapPayload(heatmapId);
              set((s) => ({ payloads: { ...s.payloads, [heatmapId]: payload } }), false, 'heatmap/payload');
            } finally {
              loadingPayloads.delete(heatmapId);
            }
          },

          resumeInflightRuns: () => {
            const { heatmapListeners } = get();
            for (const job of readInflight()) {
              if (pollers.has(job.heatmapListenerId)) continue;
              if (!heatmapListeners.some((h) => h.id === job.heatmapListenerId)) continue;
              patchRun(job.heatmapListenerId, { ...IDLE_RUN, status: 'running', statusText: 'Reconnecting...', jobId: job.jobId }, 'heatmap/resume');
              poll(job.heatmapListenerId, job.jobId, job.pending);
            }
          },

          restoreHeatmapListeners: (saved) => {
            pollers.forEach((_t, id) => stopPoller(id));
            const results: Record<string, HeatmapResultRef> = {};
            const metrics: Record<string, HeatmapMetric> = {};
            const heatmapListeners: HeatmapListenerData[] = saved.map(({ metric, result, ...surface }) => {
              metrics[surface.id] = metric;
              if (result) results[surface.id] = result;
              return surface;
            });
            set({ heatmapListeners, results, metrics, runs: {}, activeHeatmapId: null }, false, 'heatmap/restore');
            for (const r of Object.values(results)) void get().loadPayload(r.heatmapId).catch(console.warn);
            get().resumeInflightRuns();
          },

          getSavedHeatmapListeners: () => {
            const { heatmapListeners, results, metrics } = get();
            return heatmapListeners.map((h) => ({
              ...h,
              metric: metrics[h.id] ?? 'spl_a',
              result: results[h.id] ?? null,
            }));
          },
        };
      },
      { name: 'heatmapListenersStore' },
    ),
    { partialize: heatmapListenersPartialize, equality: undoEquality, limit: UNDO_HISTORY_LIMIT },
  ),
);
