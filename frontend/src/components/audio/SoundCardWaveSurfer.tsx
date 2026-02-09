'use client';

import { useRef, useEffect, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { API_BASE_URL, UI_COLORS } from '@/lib/constants';

interface SoundCardWaveSurferProps {
  /** Audio URL for the sound */
  audioUrl: string;
  /** Current volume in dB (0-100 range) */
  volumeDb: number;
  /** Whether this soundcard is currently playing */
  isPlaying: boolean;
  /** Whether this soundcard is muted */
  isMuted?: boolean;
  /** Silent mode: renders waveform visually but produces no audio (prevents double playback) */
  silent?: boolean;
  /** Callback when play/pause is clicked */
  onPlayPause: () => void;
  /** Callback when stop is clicked */
  onStop: () => void;
  /** Color for the waveform border */
  color?: string;
}

/**
 * SoundCardWaveSurfer Component
 *
 * A simple WaveSurfer waveform display for sound card previews.
 * Completely separate from the Timeline audio - no scheduling, no ambisonics.
 */
export function SoundCardWaveSurfer({
  audioUrl,
  volumeDb,
  isPlaying,
  isMuted = false,
  silent = false,
  onPlayPause,
  onStop,
  color = UI_COLORS.PRIMARY
}: SoundCardWaveSurferProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    // Cancel any pending load
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Prepare audio URL
    let fullAudioUrl: string;
    if (
      audioUrl.startsWith('http://') ||
      audioUrl.startsWith('https://') ||
      audioUrl.startsWith('blob:')
    ) {
      fullAudioUrl = audioUrl;
    } else {
      fullAudioUrl = `${API_BASE_URL}${audioUrl}`;
    }

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#9CA3AF', // Gray waveform
      progressColor: UI_COLORS.PRIMARY, // Pink progress
      cursorColor: UI_COLORS.PRIMARY,
      cursorWidth: 2,
      height: 50,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      fillParent: true,
      interact: true, // Allow seeking
      hideScrollbar: true,
    });

    wavesurfer.on('ready', () => {
      setIsReady(true);
      setDuration(wavesurfer.getDuration());
    });

    wavesurfer.on('audioprocess', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seeking', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
      // Reset to beginning and call onStop to update parent state
      setCurrentTime(0);
      wavesurfer.seekTo(0);
      onStop();
    });

    wavesurfer.on('error', (error: Error) => {
      // Suppress abort errors
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        return;
      }
      console.error('[SoundCardWaveSurfer] Error:', error);
    });

    wavesurfer.load(fullAudioUrl).catch((error: Error) => {
      // Suppress abort errors completely
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        return;
      }
      console.error('[SoundCardWaveSurfer] Load error:', error);
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      try {
        wavesurfer.destroy();
      } catch {
        // Ignore destroy errors
      }
      wavesurferRef.current = null;
      setIsReady(false);
    };
  }, [audioUrl]); // Don't include onStop in deps to avoid recreating on every render

  // Handle play/pause state changes
  useEffect(() => {
    if (!wavesurferRef.current || !isReady) return;

    try {
      if (isPlaying && !isMuted) {
        wavesurferRef.current.play();
      } else {
        wavesurferRef.current.pause();
      }
    } catch {
      // Ignore play/pause errors during transitions
    }
  }, [isPlaying, isReady, isMuted]);

  // Update volume - convert dB to linear (0-1)
  // volumeDb is in 0-100 range, we map it to 0-1 with exponential curve
  useEffect(() => {
    if (!wavesurferRef.current) return;

    if (silent || isMuted) {
      wavesurferRef.current.setVolume(0);
      return;
    }

    // Convert 0-100 dB scale to 0-1 linear with exponential curve for better feel
    // At volumeDb=0: volume=0, at volumeDb=50: volume~0.3, at volumeDb=100: volume=1
    const normalizedDb = volumeDb / 100;
    const linearVolume = Math.pow(normalizedDb, 2); // Quadratic curve for better low-end control
    wavesurferRef.current.setVolume(Math.min(1, Math.max(0, linearVolume)));
  }, [volumeDb, isMuted, silent]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2">
      {/* Waveform container */}
      <div
        className="rounded overflow-hidden"
        style={{
          border: `2px solid ${isMuted ? UI_COLORS.NEUTRAL_500 : color}`,
          backgroundColor: UI_COLORS.DARK_BG,
          borderRadius: '8px',
          opacity: isMuted ? 0.5 : 1
        }}
      >
        <div ref={containerRef} />
      </div>

      {/* Time display and controls */}
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <div className="flex items-center gap-2">
          {/* Play/Pause button */}
          <button
            onClick={onPlayPause}
            disabled={!isReady}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isPlaying ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_700,
              color: 'white',
              opacity: isReady ? 1 : 0.5
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              // Pause icon
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              // Play icon
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop button */}
          <button
            onClick={onStop}
            disabled={!isReady}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: UI_COLORS.NEUTRAL_700,
              color: 'white',
              opacity: isReady ? 1 : 0.5
            }}
            title="Stop"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
