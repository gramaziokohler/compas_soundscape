'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type WaveSurfer from 'wavesurfer.js';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { pauseStore, commitStore } from '@/store';
import { WaveSurferPlayer } from './WaveSurferPlayer';

interface SoundCardWaveSurferProps {
  audioUrl: string;
  volumeDbfs: number;
  /** Calibrated level of the audio file itself (preview gain is relative to this base). */
  baseVolumeDbfs?: number;
  isPlaying: boolean;
  isMuted?: boolean;
  silent?: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  color?: string;
  soundId?: string;
}

const HANDLE_ZONE = 10;
const DRAG_THRESHOLD = 4;

type DragPhase =
  | 'none'
  | 'pending-left'
  | 'pending-right'
  | 'pending-pan'
  | 'pending-seek'
  | 'dragging-left'
  | 'dragging-right'
  | 'dragging-pan';

export function SoundCardWaveSurfer({
  audioUrl,
  volumeDbfs,
  baseVolumeDbfs,
  isPlaying,
  isMuted = false,
  silent = false,
  onPlayPause,
  onStop,
  color = 'var(--color-primary)',
  soundId,
}: SoundCardWaveSurferProps) {
  const wsRef = useRef<WaveSurfer | null>(null);
  const waveformWrapperRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const onStopRef = useRef(onStop);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);

  // Trim state
  const [localTrimStart, setLocalTrimStart] = useState(0);
  const [localTrimEnd, setLocalTrimEnd] = useState(1);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(1);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { trimStartRef.current = localTrimStart; }, [localTrimStart]);
  useEffect(() => { trimEndRef.current = localTrimEnd; }, [localTrimEnd]);

  // Drag state
  const dragPhaseRef = useRef<DragPhase>('none');
  const dragStartXRef = useRef(0);
  const dragStartTrimRef = useRef({ start: 0, end: 1 });
  const isDraggingActiveRef = useRef(false);
  const isDraggingRef = useRef(false);
  const [cursor, setCursor] = useState('default');

  // Sync trim from store
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

  const commitTrim = useCallback((start: number, end: number) => {
    if (soundId) {
      useAudioControlsStore.getState().setSoundTrim(soundId, { start, end });
    }
    commitStore('audioControls');
  }, [soundId]);

  // Handle play/pause with trim-aware seeking
  const handlePlayPause = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) { onPlayPause(); return; }
    const dur = ws.getDuration();
    if (!isPlaying && dur > 0) {
      const frac = ws.getCurrentTime() / dur;
      if (frac < trimStartRef.current || frac >= trimEndRef.current) {
        ws.seekTo(trimStartRef.current);
        setCurrentTime(trimStartRef.current * dur);
      }
    }
    onPlayPause();
  }, [isPlaying, onPlayPause]);

  // Handle stop with trim-aware seeking
  const handleStop = useCallback((ws: WaveSurfer | null) => {
    if (ws) {
      const dur = ws.getDuration();
      ws.seekTo(trimStartRef.current);
      setCurrentTime(trimStartRef.current * dur);
    }
    onStopRef.current();
  }, []);

  // Audio process — stop at trim end
  const handleAudioProcess = useCallback((_t: number, dur: number) => {
    const ws = wsRef.current;
    if (!ws || dur <= 0) return;
    const t = ws.getCurrentTime();
    if (isPlayingRef.current && t / dur >= trimEndRef.current - 0.005) {
      ws.pause();
      ws.seekTo(trimStartRef.current);
      setCurrentTime(trimStartRef.current * dur);
      onStopRef.current();
    }
  }, []);

  // Finish — seek to trim start
  const handleFinish = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      const dur = ws.getDuration();
      ws.seekTo(trimStartRef.current);
      setCurrentTime(trimStartRef.current * dur);
    }
  }, []);

  // ── Pointer event handlers ──────────────────────────────────────────────

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
      commitTrim(trimStartRef.current, trimEndRef.current);
    } else if (!wasActive && (phase === 'pending-seek' || phase === 'pending-pan')) {
      const wrapper = waveformWrapperRef.current;
      if (wrapper && wsRef.current) {
        const rect = wrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const frac = Math.max(trimStartRef.current, Math.min(x / rect.width, trimEndRef.current));
        wsRef.current.seekTo(frac);
        setCurrentTime(frac * (wsRef.current.getDuration() || 0));
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

  const isTrimActive = localTrimStart > 0 || localTrimEnd < 1;

  const trimClearButton =
    isTrimActive ? (
      <button
        onClick={() => {
          setLocalTrimStart(0);
          setLocalTrimEnd(1);
          trimStartRef.current = 0;
          trimEndRef.current = 1;
          commitTrim(0, 1);
          if (wsRef.current) {
            wsRef.current.seekTo(0);
            setCurrentTime(0);
          }
          onStop();
        }}
        className="text-xs px-1 rounded"
        style={{ color: 'var(--color-secondary-hover)', backgroundColor: 'transparent', border: '1px solid var(--color-secondary-hover)' }}
        title="Clear trim"
      >
        ×
      </button>
    ) : null;

  return (
    <WaveSurferPlayer
      audioUrl={audioUrl}
      isPlaying={isPlaying}
      onPlayPause={handlePlayPause}
      onStop={handleStop}
      volumeDbfs={volumeDbfs}
      baseVolumeDbfs={baseVolumeDbfs}
      isMuted={isMuted}
      silent={silent}
      color={color}
      onWavesurferReady={(ws) => { wsRef.current = ws; }}
      onAudioProcess={handleAudioProcess}
      onFinish={handleFinish}
      interact={false}
      pointerHandlers={{
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerLeave: handlePointerLeave,
      }}
      cursor={cursor}
      controlsExtra={trimClearButton}
    >
      <div ref={waveformWrapperRef} />

      {/* Left exterior overlay */}
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
    </WaveSurferPlayer>
  );
}
