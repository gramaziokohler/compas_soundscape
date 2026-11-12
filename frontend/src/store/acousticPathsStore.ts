/**
 * Acoustic Paths Store
 *
 * Transient state of the sound-path view of the geometric-acoustics cards: the traced paths per
 * card (reflections, billiard rays, diffraction edges), what the 3D view draws of them, the
 * billiard playback, and which geometric engines the backend offers. Not persisted and not
 * undoable: paths are a derived view of a card's inputs, re-traced when they change. The edges a
 * user switches off are NOT here — they are a card setting (`settings.excluded_edges`), saved and
 * undoable like the rest.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { ACOUSTIC_PATHS } from '@/utils/constants';
import type { EngineCapabilities } from '@/lib/acoustics/geometric-engine';
import type { SimulationGeometryRequest } from '@/utils/simulationRequest';
import type { SimulationMeshSettings } from '@/types/simulationPreflight';
import type { AcousticPathKind, AcousticPathsEntry, AcousticPathsView } from '@/types/acousticPaths';

const EMPTY_ENTRY: AcousticPathsEntry = {
  status: 'idle',
  progress: 0,
  statusText: '',
  error: null,
  jobId: null,
  signature: null,
  payload: null,
};

const DEFAULT_VIEW: AcousticPathsView = {
  showReflections: true,
  showDiffraction: true,
  showEdges: true,
  showRays: true,
  maxOrder: ACOUSTIC_PATHS.REFLECTION_ORDER_DEFAULT,
  timeWindowMs: null,
  sourceId: null,
  receiverId: null,
  obstacleEdgesOnly: false,
};

/** What a trace computes (sent with the job). */
export interface AcousticPathsOptions {
  kinds: AcousticPathKind[];
  maxOrder: number;
  nRays: number;
  rayOrder: number;
}

const DEFAULT_OPTIONS: AcousticPathsOptions = {
  kinds: ['reflections', 'diffraction'],
  maxOrder: ACOUSTIC_PATHS.REFLECTION_ORDER_DEFAULT,
  nRays: ACOUSTIC_PATHS.RAYS_DEFAULT,
  rayOrder: ACOUSTIC_PATHS.RAY_ORDER_DEFAULT,
};

export interface RunAcousticPathsArgs {
  configId: string;
  request: SimulationGeometryRequest;
  meshSettings: SimulationMeshSettings;
  signature: string;
  excludedEdges: number[][];
}

export interface AcousticPathsStoreState {
  entries: Record<string, AcousticPathsEntry>;
  /** Card whose paths are drawn in the 3D view (null = hidden). */
  previewConfigId: string | null;
  view: AcousticPathsView;
  options: AcousticPathsOptions;
  /** Billiard playback: the hook owns the clock and reports the time here a few times a second. */
  playing: boolean;
  speed: number;
  timeMs: number;
  /** Bumped when the user scrubs, so the hook's clock jumps to `timeMs`. */
  seekSeq: number;
  durationMs: number;
  /** Clicking an edge in the 3D view switches it off / on. */
  edgeEditing: boolean;
  hoveredEdgeId: number | null;
  /** null until loaded (or when the backend predates the endpoint). */
  capabilities: EngineCapabilities | null;
  capabilitiesLoaded: boolean;

  loadCapabilities: () => Promise<void>;
  runPaths: (args: RunAcousticPathsArgs) => Promise<AcousticPathsEntry>;
  cancelPaths: (configId: string) => void;
  clearEntry: (configId: string) => void;
  setPreviewConfig: (configId: string | null) => void;
  setView: (update: Partial<AcousticPathsView>) => void;
  setOptions: (update: Partial<AcousticPathsOptions>) => void;
  toggleKind: (kind: AcousticPathKind) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  /** User scrub: jump the clock. */
  seek: (timeMs: number) => void;
  /** Clock report from the scene hook (no seek). */
  reportTime: (timeMs: number, durationMs: number) => void;
  setEdgeEditing: (on: boolean) => void;
  hoverEdge: (edgeId: number | null) => void;
}

/** In-flight poll loops, kept outside React/Zustand state (not serializable). */
const pollers = new Map<string, ReturnType<typeof setInterval>>();

function stopPoller(configId: string): void {
  const timer = pollers.get(configId);
  if (timer) clearInterval(timer);
  pollers.delete(configId);
}

export const useAcousticPathsStore = create<AcousticPathsStoreState>()(
  devtools(
    (set, get) => {
      const patch = (configId: string, update: Partial<AcousticPathsEntry>, action: string) =>
        set(
          (s) => ({ entries: { ...s.entries, [configId]: { ...(s.entries[configId] ?? EMPTY_ENTRY), ...update } } }),
          false,
          action,
        );

      return {
        entries: {},
        previewConfigId: null,
        view: { ...DEFAULT_VIEW },
        options: { ...DEFAULT_OPTIONS },
        playing: false,
        speed: ACOUSTIC_PATHS.PLAYBACK_SPEED_DEFAULT,
        timeMs: 0,
        seekSeq: 0,
        durationMs: 0,
        edgeEditing: false,
        hoveredEdgeId: null,
        capabilities: null,
        capabilitiesLoaded: false,

        loadCapabilities: async () => {
          if (get().capabilitiesLoaded) return;
          set({ capabilitiesLoaded: true }, false, 'paths/capabilitiesRequested');
          try {
            const capabilities = await apiService.getAcousticsEngines();
            set({ capabilities }, false, 'paths/capabilities');
          } catch {
            // An older backend: leave null, the card then offers everything and the run decides.
            set({ capabilities: null }, false, 'paths/capabilitiesUnavailable');
          }
        },

        runPaths: async ({ configId, request, meshSettings, signature, excludedEdges }) => {
          stopPoller(configId);
          const { options } = get();
          patch(configId, { ...EMPTY_ENTRY, status: 'running', statusText: 'Submitting...' }, 'paths/start');
          try {
            const { job_id } = await apiService.runAcousticPaths({
              projectId: request.projectId,
              versionId: request.versionId,
              objectMaterials: request.objectMaterials,
              customMaterials: request.customMaterials,
              layerName: request.layerName,
              geometryObjectIds: request.geometryObjectIds,
              objectScattering: request.objectScattering,
              sourceReceiverPairs: request.sourceReceiverPairs,
              meshSettings,
              modelId: request.modelId,
              kinds: options.kinds,
              maxOrder: options.maxOrder,
              nRays: options.nRays,
              rayOrder: options.rayOrder,
              excludedEdges,
            });
            patch(configId, { jobId: job_id, statusText: 'Queued...' }, 'paths/queued');

            return await new Promise<AcousticPathsEntry>((resolve) => {
              const finish = (update: Partial<AcousticPathsEntry>, action: string) => {
                stopPoller(configId);
                patch(configId, update, action);
                resolve(get().entries[configId]);
              };
              const timer = setInterval(async () => {
                try {
                  const st = await apiService.getAcousticPathsStatus(job_id);
                  if (st.cancelled) return finish({ status: 'idle', statusText: 'Cancelled' }, 'paths/cancelled');
                  if (st.error) return finish({ status: 'error', error: st.error, statusText: 'Error' }, 'paths/error');
                  if (!st.completed || !st.result) {
                    patch(configId, { progress: st.progress, statusText: st.status }, 'paths/progress');
                    return;
                  }
                  stopPoller(configId);
                  const payload = await apiService.getAcousticPathsPayload(st.result.paths_id);
                  finish({ status: 'done', progress: 100, statusText: 'Done', signature, payload }, 'paths/done');
                  // Show what was just traced, from the start of the billiard.
                  set((s) => ({
                    previewConfigId: configId,
                    timeMs: 0,
                    seekSeq: s.seekSeq + 1,
                    playing: false,
                    view: { ...s.view, maxOrder: Math.max(s.view.maxOrder, payload.reflections?.max_order ?? 0) },
                  }), false, 'paths/show');
                } catch (err) {
                  finish({
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Sound paths failed',
                    statusText: 'Error',
                  }, 'paths/pollError');
                }
              }, ACOUSTIC_PATHS.POLL_INTERVAL_MS);
              pollers.set(configId, timer);
            });
          } catch (err) {
            patch(configId, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Sound paths failed',
              statusText: 'Error',
            }, 'paths/submitError');
            return get().entries[configId];
          }
        },

        cancelPaths: (configId) => {
          stopPoller(configId);
          const jobId = get().entries[configId]?.jobId;
          if (jobId) apiService.cancelAcousticPaths(jobId).catch(console.warn);
          patch(configId, { status: 'idle', statusText: 'Cancelled' }, 'paths/cancel');
        },

        clearEntry: (configId) => {
          stopPoller(configId);
          set((s) => {
            const { [configId]: _removed, ...rest } = s.entries;
            return { entries: rest, previewConfigId: s.previewConfigId === configId ? null : s.previewConfigId };
          }, false, 'paths/clear');
        },

        setPreviewConfig: (configId) =>
          set({ previewConfigId: configId, hoveredEdgeId: null, playing: false, edgeEditing: configId ? get().edgeEditing : false },
            false, 'paths/preview'),
        setView: (update) => set((s) => ({ view: { ...s.view, ...update } }), false, 'paths/view'),
        setOptions: (update) => set((s) => ({ options: { ...s.options, ...update } }), false, 'paths/options'),
        toggleKind: (kind) =>
          set((s) => {
            const has = s.options.kinds.includes(kind);
            const kinds = has ? s.options.kinds.filter((k) => k !== kind) : [...s.options.kinds, kind];
            return { options: { ...s.options, kinds } };
          }, false, 'paths/toggleKind'),
        setPlaying: (playing) =>
          set((s) => (playing && s.durationMs > 0 && s.timeMs >= s.durationMs
            ? { playing, timeMs: 0, seekSeq: s.seekSeq + 1 }
            : { playing }), false, 'paths/playing'),
        setSpeed: (speed) => set({ speed }, false, 'paths/speed'),
        seek: (timeMs) => set((s) => ({ timeMs, seekSeq: s.seekSeq + 1 }), false, 'paths/seek'),
        reportTime: (timeMs, durationMs) => set({ timeMs, durationMs }, false, 'paths/time'),
        setEdgeEditing: (on) => set({ edgeEditing: on, hoveredEdgeId: null }, false, 'paths/edgeEditing'),
        hoverEdge: (edgeId) => set((s) => (s.hoveredEdgeId === edgeId ? {} : { hoveredEdgeId: edgeId }), false, 'paths/hoverEdge'),
      };
    },
    { name: 'acousticPathsStore' },
  ),
);
