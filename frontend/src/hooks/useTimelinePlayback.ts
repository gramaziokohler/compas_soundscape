'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TimelinePlaybackState, TimelineSound } from '@/types/audio';
import { AUDIO_TIMELINE } from '@/lib/constants';

interface UseTimelinePlaybackProps {
  sounds: TimelineSound[];
  duration?: number; // Optional timeline duration in ms
}

/**
 * Custom hook for managing audio timeline playback state
 *
 * Features:
 * - Play/Pause/Stop controls
 * - Real-time current time tracking
 * - Automatic loop when reaching the end
 * - Reset on stop
 *
 * @param sounds - Array of scheduled sounds to display on timeline
 * @param duration - Optional timeline duration in milliseconds (default: 60 seconds)
 */
export function useTimelinePlayback({ sounds, duration = AUDIO_TIMELINE.DEFAULT_DURATION_MS }: UseTimelinePlaybackProps) {
  const [playbackState, setPlaybackState] = useState<TimelinePlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration
  });

  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number | null>(null);

  /**
   * Animation loop for updating current time
   */
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

      // Loop back to start if we reach the end
      if (newTime >= prev.duration) {
        return {
          ...prev,
          currentTime: 0,
        };
      }

      return {
        ...prev,
        currentTime: newTime,
      };
    });

    animationFrameRef.current = requestAnimationFrame(updatePlaybackTime);
  }, []);

  /**
   * Play the timeline
   */
  const play = useCallback(() => {
    setPlaybackState((prev) => ({ ...prev, isPlaying: true }));
    lastUpdateTimeRef.current = null; // Reset timing
    animationFrameRef.current = requestAnimationFrame(updatePlaybackTime);
  }, [updatePlaybackTime]);

  /**
   * Pause the timeline
   */
  const pause = useCallback(() => {
    setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastUpdateTimeRef.current = null;
  }, []);

  /**
   * Stop the timeline and reset to beginning
   */
  const stop = useCallback(() => {
    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: false,
      currentTime: 0,
    }));
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastUpdateTimeRef.current = null;
  }, []);

  /**
   * Seek to a specific time (used for click-to-seek functionality)
   */
  const seekTo = useCallback((timeMs: number) => {
    setPlaybackState((prev) => ({
      ...prev,
      currentTime: Math.max(0, Math.min(timeMs, prev.duration)),
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Update duration if it changes
  useEffect(() => {
    setPlaybackState((prev) => ({ ...prev, duration }));
  }, [duration]);

  return {
    playbackState,
    play,
    pause,
    stop,
    seekTo,
  };
}
