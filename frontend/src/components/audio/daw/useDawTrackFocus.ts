import { useCallback, useEffect, useRef } from 'react';
import { useUIStore } from '@/store';
import { DAW } from '@/utils/constants';
import { scrollIntoContainer } from '@/utils/scrollIntoContainer';

interface UseDawTrackFocusResult {
  /** Card index of the focused sound (its track is highlighted), or null. */
  focusedIndex: number | null;
  /** Ref callback for a track row, keyed by card index. */
  registerRow: (configIdx: number | undefined) => (el: HTMLDivElement | null) => void;
  /** A track (name or clip) was clicked: focus its sound. */
  /** `entityNodeId` singles out one of the sound's linked entities (a clicked clip). */
  focusTrack: (configIdx: number, entityNodeId?: string) => void;
}

/**
 * DAW side of the shared sound focus (`uiStore.soundFocus`):
 * - the focused sound's track is highlighted;
 * - a focus from the 3D scene or a sound card scrolls its track into view, below the
 *   sticky ruler. So does an existing focus when the dock mounts (expanded after the click);
 * - a track click focuses its sound (source `'daw'`), so the sphere and an open card follow.
 *   It never opens the scene panel / sidebar.
 *
 * Usage:
 * ```tsx
 * const { focusedIndex, registerRow, focusTrack } = useDawTrackFocus();
 * <div ref={registerRow(configIdx)}>…</div>
 * ```
 */
export function useDawTrackFocus(): UseDawTrackFocusResult {
  const soundFocus = useUIStore((s) => s.soundFocus);
  const rowsRef = useRef(new Map<number, HTMLDivElement>());
  const refCallbacks = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const scrolledVersionRef = useRef<number | null>(null);

  const registerRow = useCallback((configIdx: number | undefined) => {
    if (configIdx === undefined) return () => {};
    let cb = refCallbacks.current.get(configIdx);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) rowsRef.current.set(configIdx, el);
        else rowsRef.current.delete(configIdx);
      };
      refCallbacks.current.set(configIdx, cb);
    }
    return cb;
  }, []);

  useEffect(() => {
    if (!soundFocus || scrolledVersionRef.current === soundFocus.version) return;
    const isMount = scrolledVersionRef.current === null;
    scrolledVersionRef.current = soundFocus.version;
    if (soundFocus.source === 'daw' && !isMount) return; // the user's own click is in view
    scrollIntoContainer(rowsRef.current.get(soundFocus.index) ?? null, {
      align: 'nearest',
      offset: DAW.RULER_HEIGHT,
    });
  }, [soundFocus?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusTrack = useCallback((configIdx: number, entityNodeId?: string) => {
    useUIStore.getState().focusSound(configIdx, 'daw', false, entityNodeId);
  }, []);

  return { focusedIndex: soundFocus?.index ?? null, registerRow, focusTrack };
}
