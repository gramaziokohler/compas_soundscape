/**
 * PFFDTD Visuals Store
 *
 * Transient state of the wave-based card's 3D visuals: the voxel preview per
 * card (job progress, payload, boundary-node points, staleness signature), the
 * overlay shown in the viewer (voxel grid / SPL slice / wave animation), the
 * field view (overlay, source, strength-G slice) remembered per card, the
 * animation playback, and a cache of downloaded field buffers (volume +
 * plane) per simulation. Not persisted and not undoable: everything here is
 * re-derived from the backend (field files lazily, from the results JSON).
 *
 * The voxel overlay and the geometry-preflight preview are mutually
 * exclusive (the preflight preview hides the Speckle model): showing voxels
 * clears `simulationPreflightStore.previewConfigId`; the scene hook clears the
 * voxel overlay when a preflight preview opens.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { PFFDTD, PFFDTD_VISUALS } from '@/utils/constants';
import { useSimulationPreflightStore } from './simulationPreflightStore';
import { energySumSpl } from '@/lib/acoustics/pffdtd-field';
import { PFFDTD_ALL_SOURCES } from '@/types/pffdtd';
import type {
  PffdtdFieldBlock,
  PffdtdLegendBounds,
  PffdtdOverlayKind,
  PffdtdSlice,
  PffdtdVoxelPoints,
  PffdtdVoxelPreviewPayload,
} from '@/types/pffdtd';
import type { SimulationGeometryRequest } from '@/utils/simulationRequest';
import type { SimulationMeshSettings } from '@/types/simulationPreflight';

export interface PffdtdVoxelPreviewEntry {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  statusText: string;
  error: string | null;
  jobId: string | null;
  /** Request signature the result was computed for (stale when it differs). */
  signature: string | null;
  payload: PffdtdVoxelPreviewPayload | null;
  points: PffdtdVoxelPoints | null;
}

export interface PffdtdOverlay {
  configId: string;
  kind: PffdtdOverlayKind;
  /** Completed simulation the SPL / animation data comes from (null for voxels). */
  simulationId: string | null;
  /** Source shown (SPL may use PFFDTD_ALL_SOURCES); null for voxels. */
  sourceId: string | null;
  /** Strength-G volume slice (SPL only); null / absent = the default horizontal slice. */
  slice?: PffdtdSlice | null;
  /** Colour-bar bounds of the SPL map; null / absent = the source's own min / max. */
  legend?: PffdtdLegendBounds | null;
}

/** Downloaded field data of one simulation. */
export interface PffdtdFieldCacheEntry {
  status: 'loading' | 'ready' | 'missing' | 'error';
  error: string | null;
  block: PffdtdFieldBlock | null;
  /** Animation-plane mask [ny·nx]. */
  mask: Uint8Array | null;
  /** Strength-G volume mask [nz·ny·nx]; null for results without a volume. */
  volumeMask: Uint8Array | null;
  /**
   * Strength G by source id (+ PFFDTD_ALL_SOURCES once computed): the volume
   * [nz·ny·nx] when `block.volume` exists, else the plane map [ny·nx].
   */
  spl: Record<string, Float32Array>;
  /** Animation frames by source id. */
  frames: Record<string, Int8Array>;
  /** Per-source buffer currently downloading ("spl:<id>" / "frames:<id>"). */
  pending: string[];
  /** True when a field file returned 404 (expired — re-run to regenerate). */
  expired: boolean;
}

/** Field overlay a card's results last showed (restored when the card is reopened). */
export interface PffdtdFieldView {
  kind: 'spl' | 'field';
  sourceId: string;
  slice?: PffdtdSlice | null;
  legend?: PffdtdLegendBounds | null;
}

export interface RunVoxelPreviewArgs {
  configId: string;
  request: SimulationGeometryRequest;
  fmax: number;
  ppw: number;
  meshSettings: SimulationMeshSettings;
  signature: string;
}

export interface PffdtdVisualsStoreState {
  voxelPreviews: Record<string, PffdtdVoxelPreviewEntry>;
  overlay: PffdtdOverlay | null;
  playing: boolean;
  frame: number;
  fps: number;
  fields: Record<string, PffdtdFieldCacheEntry>;
  focusedProblemId: string | null;
  /** Bumped on every focus request so re-clicking the same problem re-frames it. */
  focusSeq: number;
  /** Field-plane overlay per card config id (null = the user chose "None"). */
  fieldViews: Record<string, PffdtdFieldView | null>;

  runVoxelPreview: (args: RunVoxelPreviewArgs) => Promise<void>;
  cancelVoxelPreview: (configId: string) => void;
  clearVoxelPreview: (configId: string) => void;
  setOverlay: (overlay: PffdtdOverlay | null) => void;
  /** Show a card's field overlay (or none) and remember the choice for that card. */
  selectFieldView: (configId: string, simulationId: string, view: PffdtdFieldView | null) => void;
  /** Move a card's strength-G slice (remembered with its field view; redraws its overlay). */
  setFieldSlice: (configId: string, slice: PffdtdSlice) => void;
  /** Set (or reset with null) a card's SPL colour-bar bounds (remembered with its field view). */
  setFieldLegend: (configId: string, legend: PffdtdLegendBounds | null) => void;
  setPlaying: (playing: boolean) => void;
  setFrame: (frame: number) => void;
  setFps: (fps: number) => void;
  focusProblem: (problemId: string | null) => void;
  /** Fetch the results JSON field block + mask of a simulation (once). */
  loadField: (simulationId: string) => Promise<void>;
  /** Drop a simulation's cached field data and fetch it again (e.g. after a new animation). */
  reloadField: (simulationId: string) => Promise<void>;
  /** Fetch one source's strength G (volume or plane) or animation frames (once); handles "All sources". */
  loadSourceData: (simulationId: string, sourceId: string, kind: 'spl' | 'frames') => Promise<void>;
}

const EMPTY_PREVIEW: PffdtdVoxelPreviewEntry = {
  status: 'idle',
  progress: 0,
  statusText: '',
  error: null,
  jobId: null,
  signature: null,
  payload: null,
  points: null,
};

const EMPTY_FIELD: PffdtdFieldCacheEntry = {
  status: 'loading',
  error: null,
  block: null,
  mask: null,
  volumeMask: null,
  spl: {},
  frames: {},
  pending: [],
  expired: false,
};

/** In-flight poll loops, kept outside Zustand state (not serializable). */
const pollers = new Map<string, ReturnType<typeof setInterval>>();

function stopPoller(configId: string): void {
  const timer = pollers.get(configId);
  if (timer) clearInterval(timer);
  pollers.delete(configId);
}

export const usePffdtdVisualsStore = create<PffdtdVisualsStoreState>()(
  devtools(
    (set, get) => {
      const patchPreview = (configId: string, update: Partial<PffdtdVoxelPreviewEntry>, action: string) =>
        set(
          (s) => ({
            voxelPreviews: {
              ...s.voxelPreviews,
              [configId]: { ...(s.voxelPreviews[configId] ?? EMPTY_PREVIEW), ...update },
            },
          }),
          false,
          action,
        );

      const patchField = (simulationId: string, update: Partial<PffdtdFieldCacheEntry>, action: string) =>
        set(
          (s) => ({
            fields: { ...s.fields, [simulationId]: { ...(s.fields[simulationId] ?? EMPTY_FIELD), ...update } },
          }),
          false,
          action,
        );

      /** Download one per-source buffer into the cache (no-op when present or pending). */
      const fetchSourceBuffer = async (simulationId: string, sourceId: string, kind: 'spl' | 'frames') => {
        const entry = get().fields[simulationId];
        const block = entry?.block;
        if (!entry || !block) return;
        const key = `${kind}:${sourceId}`;
        if ((kind === 'spl' ? entry.spl[sourceId] : entry.frames[sourceId]) || entry.pending.includes(key)) return;
        const source = block.sources.find((src) => src.source_id === sourceId);
        const splFile = block.volume
          ? block.volume.sources.find((src) => src.source_id === sourceId)?.spl_volume_file
          : source?.spl_file;
        const file = kind === 'spl' ? splFile : source?.animation?.file;
        if (!file) return;

        patchField(simulationId, { pending: [...entry.pending, key] }, 'pffdtd/fieldPending');
        try {
          const buffer = await apiService.getPffdtdFieldFile(simulationId, file);
          const current = get().fields[simulationId] ?? EMPTY_FIELD;
          const pending = current.pending.filter((k) => k !== key);
          if (!buffer) {
            patchField(simulationId, { pending, expired: true }, 'pffdtd/fieldExpired');
            return;
          }
          if (kind === 'spl') {
            patchField(simulationId, { pending, spl: { ...current.spl, [sourceId]: new Float32Array(buffer) } }, 'pffdtd/splLoaded');
          } else {
            patchField(simulationId, { pending, frames: { ...current.frames, [sourceId]: new Int8Array(buffer) } }, 'pffdtd/framesLoaded');
          }
        } catch (err) {
          const current = get().fields[simulationId] ?? EMPTY_FIELD;
          patchField(simulationId, {
            pending: current.pending.filter((k) => k !== key),
            error: err instanceof Error ? err.message : 'Failed to load field data',
          }, 'pffdtd/fieldError');
        }
      };

      return {
        voxelPreviews: {},
        overlay: null,
        playing: false,
        frame: 0,
        fps: PFFDTD_VISUALS.DEFAULT_FPS,
        fields: {},
        focusedProblemId: null,
        focusSeq: 0,
        fieldViews: {},

        runVoxelPreview: async ({ configId, request, fmax, ppw, meshSettings, signature }) => {
          stopPoller(configId);
          patchPreview(configId, { ...EMPTY_PREVIEW, status: 'running', statusText: 'Submitting voxel preview...' }, 'pffdtd/previewStart');
          try {
            const { job_id } = await apiService.runPffdtdVoxelPreview(request, { fmax, ppw }, meshSettings);
            patchPreview(configId, { jobId: job_id, statusText: 'Queued...' }, 'pffdtd/previewQueued');
            await new Promise<void>((resolve) => {
              const finish = (update: Partial<PffdtdVoxelPreviewEntry>, action: string) => {
                stopPoller(configId);
                patchPreview(configId, update, action);
                resolve();
              };
              const timer = setInterval(async () => {
                try {
                  const st = await apiService.getPffdtdVoxelPreviewStatus(job_id);
                  if (st.cancelled) return finish({ status: 'idle', statusText: 'Cancelled' }, 'pffdtd/previewCancelled');
                  if (st.error) return finish({ status: 'error', error: st.error, statusText: 'Error' }, 'pffdtd/previewError');
                  if (!st.completed || !st.result) {
                    patchPreview(configId, { progress: st.progress, statusText: st.status }, 'pffdtd/previewProgress');
                    return;
                  }
                  stopPoller(configId);
                  const payload = await apiService.getPffdtdVoxelPreview(st.result.preview_id);
                  const points = payload.n_points > 0
                    ? await apiService.getPffdtdVoxelPoints(payload.preview_id, payload.n_points)
                    : null;
                  finish({ status: 'done', progress: 100, statusText: 'Done', signature, payload, points }, 'pffdtd/previewDone');
                } catch (err) {
                  finish({
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Voxel preview failed',
                    statusText: 'Error',
                  }, 'pffdtd/previewPollError');
                }
              }, PFFDTD.PREVIEW_POLL_INTERVAL_MS);
              pollers.set(configId, timer);
            });
          } catch (err) {
            patchPreview(configId, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Voxel preview failed',
              statusText: 'Error',
            }, 'pffdtd/previewSubmitError');
          }
        },

        cancelVoxelPreview: (configId) => {
          stopPoller(configId);
          const jobId = get().voxelPreviews[configId]?.jobId;
          if (jobId) apiService.cancelPffdtdVoxelPreview(jobId).catch(console.warn);
          patchPreview(configId, { status: 'idle', statusText: 'Cancelled' }, 'pffdtd/previewCancel');
        },

        clearVoxelPreview: (configId) => {
          stopPoller(configId);
          set((s) => {
            const { [configId]: _removed, ...rest } = s.voxelPreviews;
            const dropOverlay = s.overlay?.configId === configId && s.overlay.kind === 'voxels';
            return { voxelPreviews: rest, overlay: dropOverlay ? null : s.overlay };
          }, false, 'pffdtd/previewClear');
        },

        setOverlay: (overlay) => {
          if (overlay?.kind === 'voxels') {
            const preflight = useSimulationPreflightStore.getState();
            if (preflight.previewConfigId) preflight.setPreviewConfig(null);
          }
          const prev = get().overlay;
          const sameAnimation = prev?.kind === 'field' && overlay?.kind === 'field'
            && prev.simulationId === overlay.simulationId && prev.sourceId === overlay.sourceId;
          set(
            sameAnimation ? { overlay } : { overlay, playing: false, frame: 0, focusedProblemId: null },
            false,
            'pffdtd/overlay',
          );
        },

        selectFieldView: (configId, simulationId, view) => {
          set((s) => ({ fieldViews: { ...s.fieldViews, [configId]: view } }), false, 'pffdtd/fieldView');
          get().setOverlay(view ? { configId, kind: view.kind, simulationId, sourceId: view.sourceId, slice: view.slice ?? null, legend: view.legend ?? null } : null);
        },

        setFieldLegend: (configId, legend) =>
          set((s) => {
            const view = s.fieldViews[configId];
            const overlay = s.overlay?.configId === configId ? { ...s.overlay, legend } : s.overlay;
            return { fieldViews: view ? { ...s.fieldViews, [configId]: { ...view, legend } } : s.fieldViews, overlay };
          }, false, 'pffdtd/fieldLegend'),

        setFieldSlice: (configId, slice) =>
          set((s) => {
            const view = s.fieldViews[configId];
            const overlay = s.overlay?.configId === configId ? { ...s.overlay, slice } : s.overlay;
            return { fieldViews: view ? { ...s.fieldViews, [configId]: { ...view, slice } } : s.fieldViews, overlay };
          }, false, 'pffdtd/fieldSlice'),

        setPlaying: (playing) => set({ playing }, false, 'pffdtd/playing'),
        setFrame: (frame) => set({ frame }, false, 'pffdtd/frame'),
        setFps: (fps) => set({ fps }, false, 'pffdtd/fps'),
        focusProblem: (problemId) =>
          set((s) => ({ focusedProblemId: problemId, focusSeq: s.focusSeq + 1 }), false, 'pffdtd/focusProblem'),

        reloadField: async (simulationId) => {
          set((s) => {
            const { [simulationId]: _dropped, ...rest } = s.fields;
            return { fields: rest, playing: false, frame: 0 };
          }, false, 'pffdtd/fieldReload');
          await get().loadField(simulationId);
        },

        loadField: async (simulationId) => {
          const existing = get().fields[simulationId];
          if (existing && existing.status !== 'error') return;
          patchField(simulationId, { ...EMPTY_FIELD }, 'pffdtd/fieldLoad');
          try {
            const results = await apiService.getPffdtdResults(simulationId);
            const block = results?.field ?? null;
            if (!block) {
              patchField(simulationId, { status: 'missing', expired: !results }, 'pffdtd/fieldMissing');
              return;
            }
            const [maskBuffer, volumeMaskBuffer] = await Promise.all([
              apiService.getPffdtdFieldFile(simulationId, block.mask_file),
              block.volume ? apiService.getPffdtdFieldFile(simulationId, block.volume.mask_file) : Promise.resolve(null),
            ]);
            patchField(simulationId, {
              status: 'ready',
              block,
              mask: maskBuffer ? new Uint8Array(maskBuffer) : null,
              volumeMask: volumeMaskBuffer ? new Uint8Array(volumeMaskBuffer) : null,
              expired: !maskBuffer || (!!block.volume && !volumeMaskBuffer),
            }, 'pffdtd/fieldReady');
          } catch (err) {
            patchField(simulationId, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Failed to load field data',
            }, 'pffdtd/fieldLoadError');
          }
        },

        loadSourceData: async (simulationId, sourceId, kind) => {
          const block = get().fields[simulationId]?.block;
          if (!block) return;
          if (kind === 'frames' || sourceId !== PFFDTD_ALL_SOURCES) {
            await fetchSourceBuffer(simulationId, sourceId, kind);
            return;
          }
          // "All sources": energy sum of every source's strength G, cached under the pseudo id.
          if (get().fields[simulationId]?.spl[PFFDTD_ALL_SOURCES]) return;
          await Promise.all(block.sources.map((src) => fetchSourceBuffer(simulationId, src.source_id, 'spl')));
          const entry = get().fields[simulationId];
          if (!entry) return;
          const maps = block.sources.map((src) => entry.spl[src.source_id]).filter((m): m is Float32Array => !!m);
          if (maps.length !== block.sources.length || maps.length === 0) return;
          patchField(simulationId, { spl: { ...entry.spl, [PFFDTD_ALL_SOURCES]: energySumSpl(maps) } }, 'pffdtd/splSum');
        },
      };
    },
    { name: 'pffdtdVisualsStore' },
  ),
);
