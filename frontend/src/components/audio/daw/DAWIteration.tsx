'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { API_BASE_URL } from '@/utils/constants';

export interface IterationContextMenuData {
  x: number;
  y: number;
  iterationIndex: number;
}

export interface DAWIterationProps {
  soundId: string;
  iterationIndex: number;
  startMs: number;
  durationMs: number;
  pxPerSecond: number;
  audioUrl?: string;
  color: string;
  isMuted: boolean;
  /** Is this a timestamp-mode track (drag + delete enabled)? */
  isDraggable: boolean;
  timelineDurationMs: number;
  /** Sibling iterations for overlap clamping — excludes self */
  siblings: Array<{ startMs: number; durationMs: number }>;
  onDelete: () => void;
  onClick: () => void;
  onDragEnd: (newStartMs: number) => void;
  onDuplicate: (newStartMs: number) => void;
  onContextMenu: (data: IterationContextMenuData) => void;
}

export function DAWIteration({
  iterationIndex,
  startMs,
  durationMs,
  pxPerSecond,
  audioUrl,
  color,
  isMuted,
  isDraggable,
  timelineDurationMs,
  siblings,
  onDelete,
  onClick,
  onDragEnd,
  onDuplicate,
  onContextMenu,
}: DAWIterationProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [dragOffsetMs, setDragOffsetMs] = useState(0);
  const isDraggingRef = useRef(false);
  const isDuplicatingRef = useRef(false);
  const startXRef = useRef(0);
  const dragOffsetMsRef = useRef(0);
  const waveContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const leftPx = ((startMs + dragOffsetMs) / 1000) * pxPerSecond;
  const widthPx = Math.max((durationMs / 1000) * pxPerSecond, 4);

  // ── Clamp so block doesn't overlap siblings ─────────────────────────────
  const clampToFree = useCallback(
    (proposedStart: number): number => {
      let clamped = Math.max(0, Math.min(timelineDurationMs - durationMs, proposedStart));
      for (const sib of siblings) {
        const sibEnd = sib.startMs + sib.durationMs;
        const myEnd = clamped + durationMs;
        if (clamped < sibEnd && myEnd > sib.startMs) {
          if (proposedStart >= startMs) {
            clamped = sibEnd;
          } else {
            clamped = sib.startMs - durationMs;
          }
          clamped = Math.max(0, Math.min(timelineDurationMs - durationMs, clamped));
        }
      }
      return clamped;
    },
    [siblings, startMs, durationMs, timelineDurationMs],
  );

  // ── WaveSurfer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!waveContainerRef.current || !audioUrl) return;
    const resolvedUrl =
      audioUrl.startsWith('blob:') || audioUrl.startsWith('http')
        ? audioUrl
        : `${API_BASE_URL}${audioUrl}`;

    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      height: 28,
      waveColor: isMuted ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)',
      progressColor: 'transparent',
      cursorWidth: 0,
      interact: false,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
    });
    ws.load(resolvedUrl).catch(() => {});
    wsRef.current = ws;
    return () => {
      try { ws.destroy(); } catch { /* ignore */ }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  useEffect(() => {
    if (!wsRef.current) return;
    wsRef.current.setOptions({ waveColor: isMuted ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)' });
  }, [isMuted]);

  // ── Pointer drag / duplicate ───────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggable) return;
      if (e.button === 2) return; // right-click handled separately
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      isDuplicatingRef.current = e.ctrlKey || e.metaKey;
      startXRef.current = e.clientX;
      dragOffsetMsRef.current = 0;

      const handleMove = (ev: PointerEvent) => {
        if (!isDraggingRef.current) return;
        const deltaMs = ((ev.clientX - startXRef.current) / pxPerSecond) * 1000;
        const newStart = clampToFree(startMs + deltaMs);
        dragOffsetMsRef.current = newStart - startMs;
        setDragOffsetMs(newStart - startMs);
      };

      const handleUp = () => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        const finalDelta = dragOffsetMsRef.current;
        const isDup = isDuplicatingRef.current;
        setDragOffsetMs(0);
        dragOffsetMsRef.current = 0;

        if (Math.abs(finalDelta) > 3) {
          const newStart = clampToFree(startMs + finalDelta);
          if (isDup) {
            onDuplicate(newStart);
          } else {
            onDragEnd(newStart);
          }
        } else {
          onClick();
        }
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [isDraggable, pxPerSecond, startMs, clampToFree, onDuplicate, onDragEnd, onClick],
  );

  const handleContextMenuEvt = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu({ x: e.clientX, y: e.clientY, iterationIndex });
    },
    [onContextMenu, iterationIndex],
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      onClick={isDraggable ? undefined : onClick}
      onContextMenu={handleContextMenuEvt}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'absolute',
        left: `${leftPx}px`,
        top: '4px',
        width: `${widthPx}px`,
        height: 'calc(100% - 8px)',
        backgroundColor: isMuted ? 'rgba(100,100,100,0.35)' : `${color}bb`,
        borderRadius: '3px',
        border: `1px solid ${isMuted ? 'rgba(150,150,150,0.4)' : color}`,
        cursor: isDraggable
          ? isDraggingRef.current
            ? isDuplicatingRef.current ? 'copy' : 'grabbing'
            : 'grab'
          : 'pointer',
        overflow: 'hidden',
        boxSizing: 'border-box',
        transition: isDraggingRef.current ? 'none' : 'opacity 0.1s',
        opacity: isDraggingRef.current ? 0.8 : 1,
        zIndex: isDraggingRef.current ? 30 : 10,
        userSelect: 'none',
        outline:
          isDraggingRef.current && isDuplicatingRef.current
            ? `2px dashed ${color}`
            : 'none',
      }}
    >
      {/* Waveform */}
      <div
        ref={waveContainerRef}
        style={{ width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.75 }}
      />

      {/* Index badge */}
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: 3,
          fontSize: '8px',
          color: 'rgba(255,255,255,0.75)',
          lineHeight: 1,
          pointerEvents: 'none',
          fontFamily: 'monospace',
        }}
      >
        {iterationIndex + 1}
      </span>

      {/* Hover icons row (top-right) */}
      {isHovered && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            display: 'flex',
            gap: '2px',
            alignItems: 'center',
            zIndex: 31,
          }}
        >
          {/* Context menu trigger */}
          <span
            title="Linked entities / Variants (right-click)"
            style={{
              width: 13,
              height: 13,
              borderRadius: '2px',
              backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'context-menu',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu({ x: e.clientX, y: e.clientY, iterationIndex });
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5">
              <circle cx="12" cy="8" r="3" />
              <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
            </svg>
          </span>

          {/* Delete — only in timestamps mode */}
          {isDraggable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                width: 13,
                height: 13,
                borderRadius: '2px',
                backgroundColor: 'var(--color-error)',
                border: 'none',
                color: 'white',
                fontSize: '9px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                padding: 0,
              }}
              title="Remove iteration"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}


