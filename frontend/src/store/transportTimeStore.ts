import { create } from 'zustand';

/**
 * Live timeline playhead position (ms), written every animation frame by
 * `useTransportClock` while the transport runs.
 *
 * Kept out of React state on purpose: only the few widgets that draw the
 * playhead (DAW cursor, time label, loop check) subscribe here, so playback no
 * longer re-renders the whole scene tree every frame. Play/pause/duration stay
 * in `useTransportClock`'s `playbackState`.
 *
 * `isApplyingIRs` / `irSwapProgress` mirror the AudioOrchestrator's IR swap
 * (useIRSwapIndicator): a simulation or listener switch whose IRs take longer than
 * IR_SWAP.SPINNER_DELAY_MS to prepare, while the previous IRs keep playing.
 */
interface TransportTimeState {
  currentTimeMs: number;
  setCurrentTimeMs: (ms: number) => void;
  isApplyingIRs: boolean;
  /** IRs fetched + decoded so far for the swap in progress (null when idle). */
  irSwapProgress: { loaded: number; total: number } | null;
  setApplyingIRs: (applying: boolean, progress?: { loaded: number; total: number } | null) => void;
  /** Sounds loading after a scene switch (the timeline waits for them); null when idle. */
  sceneLoadProgress: { loaded: number; total: number } | null;
  setSceneLoadProgress: (progress: { loaded: number; total: number } | null) => void;
}

export const useTransportTimeStore = create<TransportTimeState>((set, get) => ({
  currentTimeMs: 0,
  setCurrentTimeMs: (ms) => {
    if (get().currentTimeMs !== ms) set({ currentTimeMs: ms });
  },
  isApplyingIRs: false,
  irSwapProgress: null,
  sceneLoadProgress: null,
  setSceneLoadProgress: (progress) => {
    const prev = get().sceneLoadProgress;
    if (prev?.loaded !== progress?.loaded || prev?.total !== progress?.total) set({ sceneLoadProgress: progress });
  },
  setApplyingIRs: (applying, progress = null) => {
    const prev = get();
    const next = applying ? progress : null;
    if (
      prev.isApplyingIRs !== applying ||
      prev.irSwapProgress?.loaded !== next?.loaded ||
      prev.irSwapProgress?.total !== next?.total
    ) {
      set({ isApplyingIRs: applying, irSwapProgress: next });
    }
  },
}));

/** Whole seconds of the playhead — for labels that only show `m:ss`. */
export const selectTransportWholeSeconds = (s: TransportTimeState): number =>
  Math.floor(Math.max(0, s.currentTimeMs) / 1000);
