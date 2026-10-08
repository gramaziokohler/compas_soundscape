/**
 * Simulation Preflight Store
 *
 * Transient state of the pre-simulation geometry check, keyed by simulation
 * card config id, plus the 3D preview options shared by all cards (view mode,
 * filters, focused issue). Not persisted and not undoable: a preflight is a
 * cheap, derived view of the current inputs, re-run whenever they change.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { SIMULATION_PREFLIGHT } from '@/utils/constants';
import type { SimulationGeometryRequest } from '@/utils/simulationRequest';
import type {
  PreflightEntry,
  PreflightFilters,
  PreflightViewMode,
  SimulationEngine,
  SimulationMeshSettings,
} from '@/types/simulationPreflight';

const EMPTY_ENTRY: PreflightEntry = {
  status: 'idle',
  progress: 0,
  statusText: '',
  error: null,
  jobId: null,
  signature: null,
  engine: null,
  summary: null,
  payload: null,
};

const DEFAULT_FILTERS: PreflightFilters = {
  reflectingSide: true,
  backSide: true,
  closed: true,
  open: true,
  shell: true,
  interior: true,
  doubleSided: true,
  skipped: false,
  edges: true,
  holes: true,
  leaks: true,
  blockers: true,
};

export interface RunPreflightArgs {
  configId: string;
  engine: SimulationEngine;
  request: SimulationGeometryRequest;
  meshSettings: SimulationMeshSettings;
  signature: string;
  maxOrder?: number;
  rayTracing?: boolean;
}

export interface SimulationPreflightStoreState {
  entries: Record<string, PreflightEntry>;
  /** Card whose prepared mesh is shown in the 3D view (null = preview hidden). */
  previewConfigId: string | null;
  viewMode: PreflightViewMode;
  filters: PreflightFilters;
  /** Dim the preview so the Speckle model stays readable behind it. */
  ghost: boolean;
  focusedIssueId: string | null;
  hoveredIssueId: string | null;
  /** Bumped on every focus request so re-clicking the same issue re-frames it. */
  focusSeq: number;

  /** Run (or re-run) the preflight for a card; resolves with the final entry. */
  runPreflight: (args: RunPreflightArgs) => Promise<PreflightEntry>;
  cancelPreflight: (configId: string) => void;
  clearEntry: (configId: string) => void;
  setPreviewConfig: (configId: string | null) => void;
  setViewMode: (mode: PreflightViewMode) => void;
  toggleFilter: (key: keyof PreflightFilters) => void;
  setGhost: (ghost: boolean) => void;
  focusIssue: (issueId: string | null) => void;
  hoverIssue: (issueId: string | null) => void;
}

/** In-flight poll loops, kept outside React/Zustand state (not serializable). */
const pollers = new Map<string, ReturnType<typeof setInterval>>();

function stopPoller(configId: string): void {
  const timer = pollers.get(configId);
  if (timer) clearInterval(timer);
  pollers.delete(configId);
}

export const useSimulationPreflightStore = create<SimulationPreflightStoreState>()(
  devtools(
    (set, get) => {
      const patch = (configId: string, update: Partial<PreflightEntry>, action: string) =>
        set(
          (s) => ({ entries: { ...s.entries, [configId]: { ...(s.entries[configId] ?? EMPTY_ENTRY), ...update } } }),
          false,
          action,
        );

      return {
        entries: {},
        previewConfigId: null,
        viewMode: 'orientation',
        filters: { ...DEFAULT_FILTERS },
        ghost: false,
        focusedIssueId: null,
        hoveredIssueId: null,
        focusSeq: 0,

        runPreflight: async ({ configId, engine, request, meshSettings, signature, maxOrder, rayTracing }) => {
          stopPoller(configId);
          patch(configId, {
            ...EMPTY_ENTRY,
            status: 'running',
            statusText: 'Submitting geometry check...',
            engine,
          }, 'preflight/start');

          try {
            const { job_id } = await apiService.runSimulationPreflight({
              engine,
              projectId: request.projectId,
              modelId: request.modelId,
              objectMaterials: request.objectMaterials,
              layerName: request.layerName,
              geometryObjectIds: request.geometryObjectIds,
              objectScattering: request.objectScattering,
              sourceReceiverPairs: request.sourceReceiverPairs,
              maxOrder,
              rayTracing,
              meshSettings,
            });
            patch(configId, { jobId: job_id, statusText: 'Queued...' }, 'preflight/queued');

            return await new Promise<PreflightEntry>((resolve) => {
              const finish = (update: Partial<PreflightEntry>, action: string) => {
                stopPoller(configId);
                patch(configId, update, action);
                resolve(get().entries[configId]);
              };
              const timer = setInterval(async () => {
                try {
                  const st = await apiService.getSimulationPreflightStatus(job_id);
                  if (st.cancelled) return finish({ status: 'idle', statusText: 'Cancelled' }, 'preflight/cancelled');
                  if (st.error) return finish({ status: 'error', error: st.error, statusText: 'Error' }, 'preflight/error');
                  if (!st.completed || !st.result) {
                    patch(configId, { progress: st.progress, statusText: st.status }, 'preflight/progress');
                    return;
                  }
                  stopPoller(configId);
                  const payload = await apiService.getSimulationPreflightPayload(st.result.preflight_id);
                  const { n_errors, n_warnings, n_infos } = st.result;
                  finish({
                    status: 'done',
                    progress: 100,
                    statusText: 'Done',
                    signature,
                    summary: { n_errors, n_warnings, n_infos },
                    payload,
                  }, 'preflight/done');
                } catch (err) {
                  finish({
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Geometry check failed',
                    statusText: 'Error',
                  }, 'preflight/pollError');
                }
              }, SIMULATION_PREFLIGHT.POLL_INTERVAL_MS);
              pollers.set(configId, timer);
            });
          } catch (err) {
            patch(configId, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Geometry check failed',
              statusText: 'Error',
            }, 'preflight/submitError');
            return get().entries[configId];
          }
        },

        cancelPreflight: (configId) => {
          stopPoller(configId);
          const jobId = get().entries[configId]?.jobId;
          if (jobId) apiService.cancelSimulationPreflight(jobId).catch(console.warn);
          patch(configId, { status: 'idle', statusText: 'Cancelled' }, 'preflight/cancel');
        },

        clearEntry: (configId) => {
          stopPoller(configId);
          set((s) => {
            const { [configId]: _removed, ...rest } = s.entries;
            return {
              entries: rest,
              previewConfigId: s.previewConfigId === configId ? null : s.previewConfigId,
            };
          }, false, 'preflight/clear');
        },

        setPreviewConfig: (configId) =>
          set({ previewConfigId: configId, focusedIssueId: null, hoveredIssueId: null }, false, 'preflight/preview'),
        setViewMode: (mode) => set({ viewMode: mode }, false, 'preflight/viewMode'),
        toggleFilter: (key) =>
          set((s) => ({ filters: { ...s.filters, [key]: !s.filters[key] } }), false, 'preflight/toggleFilter'),
        setGhost: (ghost) => set({ ghost }, false, 'preflight/ghost'),
        focusIssue: (issueId) =>
          set((s) => ({ focusedIssueId: issueId, focusSeq: s.focusSeq + 1 }), false, 'preflight/focusIssue'),
        hoverIssue: (issueId) => set({ hoveredIssueId: issueId }, false, 'preflight/hoverIssue'),
      };
    },
    { name: 'simulationPreflightStore' },
  ),
);
