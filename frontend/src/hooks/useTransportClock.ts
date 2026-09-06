'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelinePlaybackState } from '@/types/audio';
import type { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';

interface UseTransportClockProps {
  /** Ref to the current PlaybackSchedulerService — may be null before the viewer/audio init completes. */
  scheduler: React.RefObject<PlaybackSchedulerService | null>;
}

/**
 * Thin React adapter around `Transport` (via `PlaybackSchedulerService`).
 *
 * This hook NEVER drives audio timing — it only reads it. A `requestAnimationFrame`
 * loop polls `getPositionMs()`/`isPlaying()`/`getDurationMs()` purely so the DAW
 * playhead and time readout can re-render; play/pause/stop/seek are pass-through
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
        setPlaybackState((prev) => {
          if (prev.isPlaying === isPlaying && prev.currentTime === currentTime && prev.duration === duration) {
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
    scheduler.current?.seek(ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { playbackState, play, pause, stop, seekTo };
}
