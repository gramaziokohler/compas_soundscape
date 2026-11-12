'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelinePlaybackState } from '@/types/audio';
import type { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { noteStudySeek } from '@/lib/study/listeningTracker';
import { useTransportTimeStore } from '@/store';

interface UseTransportClockProps {
  /** Ref to the current PlaybackSchedulerService — may be null before the viewer/audio init completes. */
  scheduler: React.RefObject<PlaybackSchedulerService | null>;
}

/**
 * Thin React adapter around `Transport` (via `PlaybackSchedulerService`).
 *
 * This hook NEVER drives audio timing — it only reads it. A `requestAnimationFrame`
 * loop polls `getPositionMs()`/`isPlaying()`/`getDurationMs()` purely so the DAW
 * playhead and time readout can update. The live position is published to
 * `useTransportTimeStore` (subscribed only by playhead widgets); `playbackState`
 * only changes on play/pause/duration or a stopped seek. play/pause/stop/seek are pass-through
 * calls straight into the transport, which is the single source of truth for
 * playback state. Replaces the old `useTimelinePlayback`, which tracked its own
 * independent wall-clock state that could drift from what was actually playing.
 */
export function useTransportClock({ scheduler }: UseTransportClockProps) {
  const [playbackState, setPlaybackState] = useState<TimelinePlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const s = scheduler.current;
      if (s) {
        const isPlaying = s.isPlaying();
        const currentTime = s.getPositionMs();
        const duration = s.getDurationMs();
        // The live playhead goes to its own store, read only by the playhead
        // widgets. React state changes only on play/pause/duration, or on a
        // position change while stopped (seek / stop), so playback does not
        // re-render the whole scene every frame.
        useTransportTimeStore.getState().setCurrentTimeMs(currentTime);
        setPlaybackState((prev) => {
          const positionMoved = !isPlaying && prev.currentTime !== currentTime;
          if (prev.isPlaying === isPlaying && prev.duration === duration && !positionMoved) {
            return prev;
          }
          return { isPlaying, currentTime, duration };
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback((fromMs?: number) => {
    void scheduler.current?.play(fromMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pause = useCallback(() => {
    scheduler.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stop = useCallback(() => {
    scheduler.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seekTo = useCallback((ms: number) => {
    const s = scheduler.current;
    noteStudySeek(s ? Math.round(s.getPositionMs()) : null, ms);
    s?.seek(ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { playbackState, play, pause, stop, seekTo };
}
