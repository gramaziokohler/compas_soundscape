'use client';

import { useRef, useEffect, useCallback } from 'react';
import { AUDIO_TIMELINE } from '@/lib/constants';
import type { TimelineSound } from '@/types/audio';

interface AudioTimelineProps {
  /** Array of scheduled sounds to display */
  sounds: TimelineSound[];
  /** Optional timeline duration in milliseconds */
  duration?: number;
  /** Current playback time in milliseconds (controlled externally) */
  currentTime?: number;
  /** Whether timeline is currently playing (controlled externally) */
  isPlaying?: boolean;
  /** Callback when user clicks on timeline to seek */
  onSeek?: (timeMs: number) => void;
}

/**
 * AudioTimeline Component
 *
 * Displays a minimalistic timeline showing scheduled sounds.
 * Features:
 * - Real-time playback cursor (vertical line in primary color)
 * - Stacked vertical list of sound tracks
 * - Each track shows scheduled iterations as filled rectangles
 * - Scrollable if too many sounds
 * - Controlled by external playback controls (Play All/Pause All/Stop All)
 * - Click-to-seek functionality to jump to any position in the timeline
 *
 * Inspired by waveform-utils.ts for visual consistency
 */
export function AudioTimeline({
  sounds,
  duration = AUDIO_TIMELINE.DEFAULT_DURATION_MS,
  currentTime = 0,
  isPlaying = false,
  onSeek
}: AudioTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);

  /**
   * Calculate timeline dimensions based on number of sounds (minimal height)
   */
  const getTimelineDimensions = useCallback(() => {
    const numTracks = sounds.length;
    const contentHeight = AUDIO_TIMELINE.PADDING_TOP + 
                          AUDIO_TIMELINE.PADDING_BOTTOM +
                          (numTracks * (AUDIO_TIMELINE.TRACK_HEIGHT + AUDIO_TIMELINE.TRACK_SPACING));
    
    return {
      width: containerRef.current?.clientWidth || 800,
      height: Math.max(AUDIO_TIMELINE.MIN_HEIGHT, contentHeight)
    };
  }, [sounds.length]);

  /**
   * Handle click on timeline to seek
   */
  const handleTimelineClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get click position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;

    // Calculate drawable area (same as in render)
    const { width } = getTimelineDimensions();
    const drawableWidth = width - AUDIO_TIMELINE.PADDING_LEFT - AUDIO_TIMELINE.PADDING_RIGHT;
    const trackStartX = AUDIO_TIMELINE.PADDING_LEFT;

    // Calculate time from click position
    const relativeX = clickX - trackStartX;
    const fraction = Math.max(0, Math.min(1, relativeX / drawableWidth));
    const timeMs = fraction * duration;

    // Call seek callback
    onSeek(timeMs);
  }, [onSeek, duration, getTimelineDimensions]);

  /**
   * Render timeline to canvas
   */
  const renderTimeline = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height: canvasHeight } = getTimelineDimensions();

    // Set canvas size with device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${canvasHeight}px`;
    ctx.scale(dpr, dpr);

    // Clear with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, canvasHeight);

    // Calculate drawable area
    const drawableWidth = width - AUDIO_TIMELINE.PADDING_LEFT - AUDIO_TIMELINE.PADDING_RIGHT;
    const trackStartX = AUDIO_TIMELINE.PADDING_LEFT;
    const trackStartY = AUDIO_TIMELINE.PADDING_TOP;

    // Draw time axis labels
    ctx.fillStyle = '#9CA3AF'; // Grey
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    
    const timeMarkers = [0, 0.25, 0.5, 0.75, 1.0];
    timeMarkers.forEach((fraction) => {
      const x = trackStartX + fraction * drawableWidth;
      const timeInSeconds = (duration * fraction) / 1000;
      ctx.fillText(`${timeInSeconds.toFixed(1)}s`, x, trackStartY - 10);
    });

    // Draw each sound track
    sounds.forEach((sound, index) => {
      const trackY = trackStartY + index * (AUDIO_TIMELINE.TRACK_HEIGHT + AUDIO_TIMELINE.TRACK_SPACING);

      // Draw track background (subtle grey)
      ctx.fillStyle = '#1F2937'; // Dark grey
      ctx.fillRect(trackStartX, trackY, drawableWidth, AUDIO_TIMELINE.TRACK_HEIGHT);

      // Draw sound name on the left
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '12px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(
        sound.displayName.substring(0, 20), // Truncate long names
        trackStartX - 10,
        trackY + AUDIO_TIMELINE.TRACK_HEIGHT / 2 + 4
      );

      // Draw scheduled iterations
      ctx.fillStyle = sound.color;
      sound.scheduledIterations.forEach((timestamp) => {
        if (timestamp > duration) return; // Skip iterations beyond timeline duration

        const x = trackStartX + (timestamp / duration) * drawableWidth;
        const iterationWidth = Math.max(
          AUDIO_TIMELINE.ITERATION_MIN_WIDTH,
          (sound.soundDurationMs / duration) * drawableWidth
        );

        // Draw rounded rectangle for iteration
        const radius = AUDIO_TIMELINE.ITERATION_BORDER_RADIUS;
        ctx.beginPath();
        ctx.roundRect(x, trackY + 5, iterationWidth, AUDIO_TIMELINE.TRACK_HEIGHT - 10, radius);
        ctx.fill();
      });
    });

    // Draw playback cursor (vertical line)
    const cursorX = trackStartX + (currentTime / duration) * drawableWidth;
    ctx.strokeStyle = AUDIO_TIMELINE.CURSOR_COLOR;
    ctx.lineWidth = AUDIO_TIMELINE.CURSOR_WIDTH;
    ctx.beginPath();
    ctx.moveTo(cursorX, trackStartY);
    ctx.lineTo(cursorX, trackStartY + sounds.length * (AUDIO_TIMELINE.TRACK_HEIGHT + AUDIO_TIMELINE.TRACK_SPACING));
    ctx.stroke();

  }, [sounds, duration, currentTime, getTimelineDimensions]);

  // Render timeline on every frame when playing, or when sounds/duration change
  useEffect(() => {
    renderTimeline();
  }, [renderTimeline, currentTime]);

  // Redraw on window resize
  useEffect(() => {
    const handleResize = () => {
      renderTimeline();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderTimeline]);

  const { height } = getTimelineDimensions();
  const hasSounds = sounds.length > 0;

  if (!hasSounds) {
    return (
      <div 
        className="bg-black/80 backdrop-blur-sm rounded-lg border border-white/20 p-6 text-center"
        style={{ height: `${AUDIO_TIMELINE.MIN_HEIGHT}px` }}
      >
        <p className="text-gray-400 text-sm">No scheduled sounds to display</p>
      </div>
    );
  }

  return (
    <div className="bg-black/80 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden" style={{ height: `${height}px` }}>
      <div ref={containerRef} className="h-full">
        <canvas
          ref={canvasRef}
          className="w-full cursor-pointer"
          onClick={handleTimelineClick}
        />
      </div>
    </div>
  );
}

