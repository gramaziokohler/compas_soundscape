'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type WaveSurfer from 'wavesurfer.js';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { pauseStore, commitStore } from '@/store';
import { registerPreviewInstance, unregisterPreviewInstance, seekPreviewInstances, getPreviewPosition } from '@/lib/audio/previewRegistry';
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

  // Drop this player from the preview registry on unmount so stopping a preview
  // never touches a destroyed WaveSurfer instance.
  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (soundId && ws) unregisterPreviewInstance(soundId, ws);
    };
  }, [soundId]);

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
  // Which trim handle is revealed — only shown while hovering a track border
  // (or actively dragging it), so the idle waveform stays clean.
  const [hoveredHandle, setHoveredHandle] = useState<'left' | 'right' | 'pan' | null>(null);

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
      const nearLeft = Math.abs(x - leftPx) <= HANDLE_ZONE;
      const nearRight = Math.abs(x - rightPx) <= HANDLE_ZONE;
      if (nearLeft || nearRight) {
        setCursor('col-resize');
        setHoveredHandle(nearLeft ? 'left' : 'right');
      } else {
        setHoveredHandle(null);
        if (isTrimActive && x > leftPx && x < rightPx) {
          setCursor('grab');
        } else {
          setCursor('default');
        }
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
        setHoveredHandle('left');
      } else if (phase === 'pending-right') {
        dragPhaseRef.current = 'dragging-right';
        pauseStore('audioControls');
        setCursor('col-resize');
        setHoveredHandle('right');
      } else if (phase === 'pending-pan') {
        dragPhaseRef.current = 'dragging-pan';
        pauseStore('audioControls');
        setCursor('grabbing');
        setHoveredHandle('pan');
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
        const seekTime = frac * (wsRef.current.getDuration() || 0);
        setCurrentTime(seekTime);
        // Move any other mounted player of this preview (e.g. the sound card)
        // to the same playhead.
        if (soundId) seekPreviewInstances(soundId, seekTime);
      }
    }

    dragPhaseRef.current = 'none';
    isDraggingActiveRef.current = false;
    isDraggingRef.current = false;
    setCursor('default');

    // Keep the handle revealed only while the pointer is still over a border.
    const wrapper = waveformWrapperRef.current;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const nearLeft = Math.abs(x - trimStartRef.current * rect.width) <= HANDLE_ZONE;
      const nearRight = Math.abs(x - trimEndRef.current * rect.width) <= HANDLE_ZONE;
      setHoveredHandle(nearLeft ? 'left' : nearRight ? 'right' : null);
    } else {
      setHoveredHandle(null);
    }
  }, [commitTrim, soundId]);

  const handlePointerLeave = useCallback(() => {
    if (dragPhaseRef.current === 'none') {
      setCursor('default');
      setHoveredHandle(null);
    }
  }, []);

  const isTrimActive = localTrimStart > 0 || localTrimEnd < 1;

  // Handles are revealed on border hover (or while dragging that handle).
  const showLeftHandle = hoveredHandle === 'left' || hoveredHandle === 'pan';
  const showRightHandle = hoveredHandle === 'right' || hoveredHandle === 'pan';

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
            if (soundId) seekPreviewInstances(soundId, 0);
          }
          onStop();
        }}
        className="text-xs px-1 rounded"
        style={{ color: 'var(--color-on-blue-muted)', backgroundColor: 'transparent', border: '1px solid var(--color-on-blue-muted)' }}
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
      backgroundColor="var(--color-blue-chip-bg)"
      onBlueBackground
      progressColor="var(--color-secondary)"
      cursorColor="var(--color-warning)"
      waveformTooltip="Amber line is the playhead · click to seek"
      onWavesurferReady={(ws) => {
        // Drop the previous instance if the player was recreated (e.g. URL change).
        if (soundId && wsRef.current && wsRef.current !== ws) {
          unregisterPreviewInstance(soundId, wsRef.current);
        }
        wsRef.current = ws;
        if (ws && soundId) {
          registerPreviewInstance(soundId, ws);
          // A player that mounts while the same preview is already at a
          // non-zero playhead (e.g. the card opened after the entity panel
          // started) must pick that position up once it is ready.
          const shared = getPreviewPosition(soundId);
          if (shared !== undefined && shared > 0) {
            ws.on('ready', () => {
              try { ws.setTime(shared); } catch { /* ignore */ }
            });
          }
        }
      }}
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
            backgroundColor: 'var(--color-blue-track-bg)',
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
            backgroundColor: 'var(--color-blue-track-bg)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}

      {/* Left trim handle */}
      <div
        title="Trim start — drag to adjust"
        style={{
          position: 'absolute',
          top: 0,
          left: `${localTrimStart * 100}%`,
          transform: 'translateX(-50%)',
          width: '3px',
          height: '100%',
          backgroundColor: 'var(--color-warning-hover)',
          pointerEvents: showLeftHandle ? 'auto' : 'none',
          borderRadius: '1.5px',
          zIndex: 5,
          opacity: showLeftHandle ? 1 : 0,
          transition: 'opacity 0.12s ease',
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
            backgroundColor: 'var(--color-warning)',
            borderRadius: '3px',
          }}
        />
      </div>

      {/* Right trim handle */}
      <div
        title="Trim end — drag to adjust"
        style={{
          position: 'absolute',
          top: 0,
          left: `${localTrimEnd * 100}%`,
          transform: 'translateX(-50%)',
          width: '3px',
          height: '100%',
          backgroundColor: 'var(--color-warning)',
          pointerEvents: showRightHandle ? 'auto' : 'none',
          borderRadius: '2px',
          zIndex: 5,
          opacity: showRightHandle ? 1 : 0,
          transition: 'opacity 0.12s ease',
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
            backgroundColor: 'var(--color-warning)',
            borderRadius: '3px',
          }}
        />
      </div>
    </WaveSurferPlayer>
  );
}
