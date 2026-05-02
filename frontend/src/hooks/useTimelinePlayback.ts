'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelinePlaybackState, TimelineSound } from '@/types/audio';
import { AUDIO_TIMELINE } from '@/utils/constants';

interface UseTimelinePlaybackProps {
  sounds: TimelineSound[];
  duration?: number;
  onEnd?: () => void;
}

/**
 * Custom hook for managing audio timeline playback state.
 *
 * End detection uses a useEffect (not a closure flag inside the rAF updater) because
 * React 18 batches state updates — the functional updater passed to setPlaybackState
 * runs asynchronously during React's render phase, AFTER the synchronous code that
 * followed the setState call has already executed. A closure variable set inside the
 * updater is therefore always stale at the check site. The effect fires reliably after
 * the state settles.
 */
export function useTimelinePlayback({ sounds, duration = AUDIO_TIMELINE.DEFAULT_DURATION_MS, onEnd }: UseTimelinePlaybackProps) {
  const [playbackState, setPlaybackState] = useState<TimelinePlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration,
  });

  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number | null>(null);
  const onEndRef = useRef(onEnd);
  /** Guard so the effect never fires onEnd twice for the same natural end event. */
  const onEndFiredRef = useRef(false);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const updatePlaybackTime = useCallback(() => {
    const now = performance.now();

    if (lastUpdateTimeRef.current === null) {
      lastUpdateTimeRef.current = now;
    }

    const deltaTime = now - lastUpdateTimeRef.current;
    lastUpdateTimeRef.current = now;

    setPlaybackState((prev) => {
      if (!prev.isPlaying) return prev;

      const newTime = prev.currentTime + deltaTime;

      if (newTime >= prev.duration) {
        return { ...prev, currentTime: prev.duration, isPlaying: false };
      }

      return { ...prev, currentTime: newTime };
    });

    // Always schedule the next frame; it will be cancelled by stop/pause or by the
    // end-detection effect below once the state update settles.
    animationFrameRef.current = requestAnimationFrame(updatePlaybackTime);
  }, []);

  /**
   * Detect the natural end of the timeline.
   *
   * Fires after React processes the state update that sets isPlaying=false at
   * currentTime=duration. A closure variable inside updatePlaybackTime cannot be used
   * for this because React 18 calls the functional updater asynchronously — it runs
   * during the render phase, which happens after the synchronous rAF callback body has
   * already finished executing.
   */
  useEffect(() => {
    const atEnd =
      !playbackState.isPlaying &&
      playbackState.currentTime >= playbackState.duration &&
      playbackState.currentTime > 0;

    if (atEnd && !onEndFiredRef.current) {
      onEndFiredRef.current = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      onEndRef.current?.();
    } else if (!atEnd) {
      // Reset guard when we leave the "at end" state (e.g. after stop() resets currentTime).
      onEndFiredRef.current = false;
    }
  }, [playbackState.isPlaying, playbackState.currentTime, playbackState.duration]);

  const play = useCallback(() => {
    onEndFiredRef.current = false;
    setPlaybackState((prev) => ({ ...prev, isPlaying: true }));
    lastUpdateTimeRef.current = null;
    animationFrameRef.current = requestAnimationFrame(updatePlaybackTime);
  }, [updatePlaybackTime]);

  const pause = useCallback(() => {
    setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastUpdateTimeRef.current = null;
  }, []);

  const stop = useCallback(() => {
    onEndFiredRef.current = false;
    setPlaybackState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastUpdateTimeRef.current = null;
  }, []);

  const seekTo = useCallback((timeMs: number) => {
    setPlaybackState((prev) => ({
      ...prev,
      currentTime: Math.max(0, Math.min(timeMs, prev.duration)),
    }));
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPlaybackState((prev) => ({ ...prev, duration }));
  }, [duration]);

  return { playbackState, play, pause, stop, seekTo };
}
