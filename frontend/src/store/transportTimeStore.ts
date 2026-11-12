import { create } from 'zustand';

/**
 * Live timeline playhead position (ms), written every animation frame by
 * `useTransportClock` while the transport runs.
 *
 * Kept out of React state on purpose: only the few widgets that draw the
 * playhead (DAW cursor, time label, loop check) subscribe here, so playback no
 * longer re-renders the whole scene tree every frame. Play/pause/duration stay
 * in `useTransportClock`'s `playbackState`.
 */
interface TransportTimeState {
  currentTimeMs: number;
  setCurrentTimeMs: (ms: number) => void;
}

export const useTransportTimeStore = create<TransportTimeState>((set, get) => ({
  currentTimeMs: 0,
  setCurrentTimeMs: (ms) => {
    if (get().currentTimeMs !== ms) set({ currentTimeMs: ms });
  },
}));

/** Whole seconds of the playhead — for labels that only show `m:ss`. */
export const selectTransportWholeSeconds = (s: TransportTimeState): number =>
  Math.floor(Math.max(0, s.currentTimeMs) / 1000);
