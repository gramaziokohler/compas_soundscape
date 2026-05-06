'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { API_BASE_URL } from '@/utils/constants';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { pauseStore, commitStore } from '@/store';

interface SoundCardWaveSurferProps {
  audioUrl: string;
  volumeDb: number;
  isPlaying: boolean;
  isMuted?: boolean;
  silent?: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  color?: string;
  /** Sound ID used to read/write trim state from the store */
  soundId?: string;
}

const HANDLE_ZONE = 10; // px on either side of handle center that counts as "on handle"
const DRAG_THRESHOLD = 4; // px before pending becomes active drag

type DragPhase =
  | 'none'
  | 'pending-left'
  | 'pending-right'
  | 'pending-pan'
  | 'pending-seek'
  | 'dragging-left'
  | 'dragging-right'
  | 'dragging-pan';

/**
 * SoundCardWaveSurfer Component
 *
 * WaveSurfer waveform display with trim handles.
 * Drag the left/right border handles to trim the effective playback region.
 * Hold and drag within the trimmed area to pan the trim window.
 * Preview playback and timeline/orchestrator both respect the active trim.
 */
export function SoundCardWaveSurfer({
  audioUrl,
  volumeDb,
  isPlaying,
  isMuted = false,
  silent = false,
  onPlayPause,
  onStop,
  color = 'var(--color-primary)',
  soundId,
}: SoundCardWaveSurferProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveformWrapperRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stable refs for callbacks
  const onStopRef = useRef(onStop);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);

  // Trim state: fractions 0-1
  const [localTrimStart, setLocalTrimStart] = useState(0);
  const [localTrimEnd, setLocalTrimEnd] = useState(1);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(1);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Keep trim refs in sync
  useEffect(() => { trimStartRef.current = localTrimStart; }, [localTrimStart]);
  useEffect(() => { trimEndRef.current = localTrimEnd; }, [localTrimEnd]);

  // Drag state
  const dragPhaseRef = useRef<DragPhase>('none');
  const dragStartXRef = useRef(0);
  const dragStartTrimRef = useRef({ start: 0, end: 1 });
  const isDraggingActiveRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Cursor
  const [cursor, setCursor] = useState('default');

  // Sync trim from store (on mount and when soundId changes; respect undo/redo)
  useEffect(() => {
    if (!soundId) return;

    const applyStoreTrim = () => {
      if (!isDraggingRef.current) {
        const trim = useAudioControlsStore.getState().soundTrims[soundId];
        setLocalTrimStart(trim?.start ?? 0);
        setLocalTrimEnd(trim?.end ?? 1);
      }
    };

    applyStoreTrim();
    const unsubscribe = useAudioControlsStore.subscribe(applyStoreTrim);
    return unsubscribe;
  }, [soundId]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    let fullAudioUrl: string;
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://') || audioUrl.startsWith('blob:')) {
      fullAudioUrl = audioUrl;
    } else {
      fullAudioUrl = `${API_BASE_URL}${audioUrl}`;
    }

    const primaryColor = resolveCssVar('var(--color-primary)');
    const secondaryHoverColor = resolveCssVar('var(--color-secondary-hover)');

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: secondaryHoverColor,
      progressColor: primaryColor,
      cursorColor: primaryColor,
      cursorWidth: 2,
      height: 50,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      fillParent: true,
      interact: false, // Handled by our overlay
      hideScrollbar: true,
    });

    wavesurfer.on('ready', () => {
      setIsReady(true);
      setDuration(wavesurfer.getDuration());
    });

    wavesurfer.on('audioprocess', () => {
      const dur = wavesurfer.getDuration();
      const t = wavesurfer.getCurrentTime();
      setCurrentTime(t);

      // Stop at trim end
      if (dur > 0 && isPlayingRef.current && t / dur >= trimEndRef.current - 0.005) {
        wavesurfer.pause();
        wavesurfer.seekTo(trimStartRef.current);
        setCurrentTime(trimStartRef.current * dur);
        onStopRef.current();
      }
    });

    wavesurfer.on('seeking', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('finish', () => {
      const dur = wavesurfer.getDuration();
      wavesurfer.seekTo(trimStartRef.current);
      setCurrentTime(trimStartRef.current * dur);
      onStopRef.current();
    });

    wavesurfer.on('error', (error: Error) => {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) return;
      console.error('[SoundCardWaveSurfer] Error:', error);
    });

    wavesurfer.load(fullAudioUrl).catch((error: Error) => {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) return;
      console.error('[SoundCardWaveSurfer] Load error:', error);
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      try { wavesurfer.destroy(); } catch { /* ignore */ }
      wavesurferRef.current = null;
      setIsReady(false);
    };
  }, [audioUrl]);

  // Handle play/pause — seek to trim start if outside trim region
  useEffect(() => {
    if (!wavesurferRef.current || !isReady) return;
    try {
      if (isPlaying && !isMuted) {
        const dur = wavesurferRef.current.getDuration();
        if (dur > 0) {
          const frac = wavesurferRef.current.getCurrentTime() / dur;
          if (frac < trimStartRef.current || frac >= trimEndRef.current) {
            wavesurferRef.current.seekTo(trimStartRef.current);
          }
        }
        wavesurferRef.current.play();
      } else {
        wavesurferRef.current.pause();
      }
    } catch { /* ignore */ }
  }, [isPlaying, isReady, isMuted]);

  // Volume
  useEffect(() => {
    if (!wavesurferRef.current) return;
    if (silent || isMuted) {
      wavesurferRef.current.setVolume(0);
      return;
    }
    const normalizedDb = volumeDb / 100;
    const linearVolume = Math.pow(normalizedDb, 2);
    wavesurferRef.current.setVolume(Math.min(1, Math.max(0, linearVolume)));
  }, [volumeDb, isMuted, silent]);

  const commitTrim = useCallback((start: number, end: number) => {
    if (soundId) {
      useAudioControlsStore.getState().setSoundTrim(soundId, { start, end });
    }
    commitStore('audioControls');
  }, [soundId]);

  // ── Pointer event handlers ──────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wrapper = waveformWrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    if (width === 0) return;

    const leftPx = localTrimStart * width;
    const rightPx = localTrimEnd * width;
    const isTrimActive = localTrimStart > 0 || localTrimEnd < 1;

    dragStartXRef.current = x;
    dragStartTrimRef.current = { start: localTrimStart, end: localTrimEnd };
    isDraggingActiveRef.current = false;

    const nearLeft = Math.abs(x - leftPx) <= HANDLE_ZONE;
    const nearRight = Math.abs(x - rightPx) <= HANDLE_ZONE;

    if (nearLeft) {
      dragPhaseRef.current = 'pending-left';
    } else if (nearRight) {
      dragPhaseRef.current = 'pending-right';
    } else if (x > leftPx && x < rightPx) {
      dragPhaseRef.current = isTrimActive ? 'pending-pan' : 'pending-seek';
    } else {
      dragPhaseRef.current = 'pending-seek';
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [localTrimStart, localTrimEnd]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wrapper = waveformWrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    if (width === 0) return;

    const phase = dragPhaseRef.current;

    if (phase === 'none') {
      // Update cursor on hover
      const leftPx = localTrimStart * width;
      const rightPx = localTrimEnd * width;
      const isTrimActive = localTrimStart > 0 || localTrimEnd < 1;
      if (Math.abs(x - leftPx) <= HANDLE_ZONE || Math.abs(x - rightPx) <= HANDLE_ZONE) {
        setCursor('col-resize');
      } else if (isTrimActive && x > leftPx && x < rightPx) {
        setCursor('grab');
      } else {
        setCursor('default');
      }
      return;
    }

    const dx = x - dragStartXRef.current;

    // Activate drag once threshold crossed
    if (!isDraggingActiveRef.current && Math.abs(dx) > DRAG_THRESHOLD) {
      isDraggingActiveRef.current = true;
      isDraggingRef.current = true;
      if (phase === 'pending-left') {
        dragPhaseRef.current = 'dragging-left';
        pauseStore('audioControls');
        setCursor('col-resize');
      } else if (phase === 'pending-right') {
        dragPhaseRef.current = 'dragging-right';
        pauseStore('audioControls');
        setCursor('col-resize');
      } else if (phase === 'pending-pan') {
        dragPhaseRef.current = 'dragging-pan';
        pauseStore('audioControls');
        setCursor('grabbing');
      }
      // pending-seek stays as click until pointerup
    }

    if (!isDraggingActiveRef.current) return;

    const delta = dx / width;
    const { start, end } = dragStartTrimRef.current;

    if (dragPhaseRef.current === 'dragging-left') {
      const newStart = Math.max(0, Math.min(start + delta, end - 0.02));
      setLocalTrimStart(newStart);
      trimStartRef.current = newStart;
    } else if (dragPhaseRef.current === 'dragging-right') {
      const newEnd = Math.max(start + 0.02, Math.min(end + delta, 1));
      setLocalTrimEnd(newEnd);
      trimEndRef.current = newEnd;
    } else if (dragPhaseRef.current === 'dragging-pan') {
      const trimWidth = end - start;
      const newStart = Math.max(0, Math.min(start + delta, 1 - trimWidth));
      const newEnd = newStart + trimWidth;
      setLocalTrimStart(newStart);
      setLocalTrimEnd(newEnd);
      trimStartRef.current = newStart;
      trimEndRef.current = newEnd;
    }
  }, [localTrimStart, localTrimEnd]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const phase = dragPhaseRef.current;
    const wasActive = isDraggingActiveRef.current;

    if (wasActive && (
      phase === 'dragging-left' ||
      phase === 'dragging-right' ||
      phase === 'dragging-pan'
    )) {
      // Commit trim to store — only after full drag gesture
      commitTrim(trimStartRef.current, trimEndRef.current);
    } else if (!wasActive && (phase === 'pending-seek' || phase === 'pending-pan')) {
      // It was a click — seek within trim region
      const wrapper = waveformWrapperRef.current;
      if (wrapper && wavesurferRef.current) {
        const rect = wrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const frac = Math.max(trimStartRef.current, Math.min(x / rect.width, trimEndRef.current));
        wavesurferRef.current.seekTo(frac);
        setCurrentTime(frac * (wavesurferRef.current.getDuration() || 0));
      }
    }

    dragPhaseRef.current = 'none';
    isDraggingActiveRef.current = false;
    isDraggingRef.current = false;
    setCursor('default');
  }, [commitTrim]);

  const handlePointerLeave = useCallback(() => {
    if (dragPhaseRef.current === 'none') {
      setCursor('default');
    }
  }, []);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isTrimActive = localTrimStart > 0 || localTrimEnd < 1;

  return (
    <div className="space-y-2 min-w-0 overflow-hidden">
      {/* Waveform container */}
      <div
        className="rounded overflow-hidden"
        style={{
          border: `2px solid ${isMuted ? 'var(--color-secondary-hover)' : color}`,
          backgroundColor: 'var(--foreground-static)',
          borderRadius: '8px',
          opacity: isMuted ? 0.5 : 1,
          position: 'relative',
        }}
      >
        {/* Overlay for trim interaction — sits on top of WaveSurfer */}
        <div
          ref={waveformWrapperRef}
          style={{
            position: 'relative',
            cursor,
            userSelect: 'none',
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          {/* WaveSurfer mounts here */}
          <div ref={containerRef} />

          {/* Left exterior overlay — covers waveform + any progress bleed in the trimmed-out region */}
          {localTrimStart > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${localTrimStart * 100}%`,
                height: '100%',
                backgroundColor: 'var(--foreground-static)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />
          )}

          {/* Right exterior overlay */}
          {localTrimEnd < 1 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: `${localTrimEnd * 100}%`,
                width: `${(1 - localTrimEnd) * 100}%`,
                height: '100%',
                backgroundColor: 'var(--foreground-static)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />
          )}

          {/* Left trim handle */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${localTrimStart * 100}%`,
              transform: 'translateX(-50%)',
              width: '3px',
              height: '100%',
              backgroundColor: color,
              pointerEvents: 'none',
              borderRadius: '2px',
              zIndex: 5,
            }}
          >
            {/* Grip nub */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '8px',
                height: '14px',
                backgroundColor: color,
                borderRadius: '3px',
              }}
            />
          </div>

          {/* Right trim handle */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${localTrimEnd * 100}%`,
              transform: 'translateX(-50%)',
              width: '3px',
              height: '100%',
              backgroundColor: color,
              pointerEvents: 'none',
              borderRadius: '2px',
              zIndex: 5,
            }}
          >
            {/* Grip nub */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '8px',
                height: '14px',
                backgroundColor: color,
                borderRadius: '3px',
              }}
            />
          </div>
        </div>
      </div>

      {/* Time display and controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-xs text-neutral-400">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          {isTrimActive && (
            <button
              onClick={() => {
                setLocalTrimStart(0);
                setLocalTrimEnd(1);
                trimStartRef.current = 0;
                trimEndRef.current = 1;
                commitTrim(0, 1);
                // Reset waveform to start, same as pressing Stop
                if (wavesurferRef.current) {
                  wavesurferRef.current.seekTo(0);
                  setCurrentTime(0);
                }
                onStop();
              }}
              className="text-xs px-1 rounded"
              style={{ color: 'var(--color-secondary-hover)', backgroundColor: 'transparent', border: `1px solid var(--color-secondary-hover)` }}
              title="Clear trim"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Play/Pause button */}
          <button
            onClick={onPlayPause}
            disabled={!isReady}
            onMouseEnter={(e) => {
              if (!isPlaying) e.currentTarget.style.backgroundColor = 'var(--color-secondary-hover-static)';
            }}
            onMouseLeave={(e) => {
              if (!isPlaying) e.currentTarget.style.backgroundColor = 'var(--color-secondary)';
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isPlaying ? color : 'var(--color-secondary)',
              color: 'white',
              opacity: isReady ? 1 : 0.5,
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop button */}
          <button
            onClick={() => {
              if (wavesurferRef.current) {
                const dur = wavesurferRef.current.getDuration();
                wavesurferRef.current.seekTo(trimStartRef.current);
                setCurrentTime(trimStartRef.current * dur);
              }
              onStop();
            }}
            disabled={!isReady}
            onMouseEnter={(e) => {
              if (!isPlaying) e.currentTarget.style.backgroundColor = 'var(--color-secondary-hover-static)';
            }}
            onMouseLeave={(e) => {
              if (!isPlaying) e.currentTarget.style.backgroundColor = 'var(--color-secondary)';
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: 'var(--color-secondary)',
              color: 'white',
              opacity: isReady ? 1 : 0.5,
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

/** Resolve a CSS custom property to its computed hex/rgb value for use with Canvas APIs. */
function resolveCssVar(variable: string, fallback = '#888888'): string {
  if (typeof window === 'undefined') return fallback;
  if (!variable.startsWith('var(')) return variable;
  const match = variable.match(/var\(\s*(--[^,)]+)/);
  if (!match) return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return val || fallback;
}
