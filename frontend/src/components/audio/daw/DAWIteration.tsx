'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { API_BASE_URL } from '@/utils/constants';
import type { IterationLink } from '@/types/audio';

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
  /** Optional per-iteration override (variant letter badge + entity link icon). */
  iterationLink?: IterationLink;
  onDelete: () => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onDragEnd: (newStartMs: number) => void;
  onDuplicate: (newStartMs: number) => void;
  onContextMenu: (data: IterationContextMenuData) => void;
  onHover?: (soundId: string, iterationIndex: number) => void;
  onHoverEnd?: () => void;
}

export function DAWIteration({
  soundId,
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
  iterationLink,
  onDelete,
  onClick,
  onDoubleClick,
  onDragEnd,
  onDuplicate,
  onContextMenu,
  onHover,
  onHoverEnd,
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
  const clippedEndMs = Math.min(startMs + dragOffsetMs + durationMs, timelineDurationMs);
  const clippedWidthMs = Math.max(clippedEndMs - Math.max(startMs + dragOffsetMs, 0), 0);
  const widthPx = Math.max((clippedWidthMs / 1000) * pxPerSecond, 4);

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
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenuEvt}
      onMouseEnter={() => { setIsHovered(true); if (iterationLink) onHover?.(soundId, iterationIndex); }}
      onMouseLeave={() => { setIsHovered(false); onHoverEnd?.(); }}
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

      {/* Top-right badge row — always rendered (badges + hover controls) */}
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
        {/* Variant letter badge — only when a variant override is explicitly assigned */}
        {iterationLink?.variantIndex !== undefined && (
          <span
            title={`Variant ${String.fromCharCode(65 + iterationLink.variantIndex)}`}
            style={{
              pointerEvents: 'none',
              fontSize: '7px',
              fontWeight: 700,
              lineHeight: 1,
              color: 'rgba(255,255,255,0.92)',
              backgroundColor: 'rgba(0,0,0,0.65)',
              borderRadius: '2px',
              padding: '1px 2px',
              flexShrink: 0,
            }}
          >
            {String.fromCharCode(65 + iterationLink.variantIndex)}
          </span>
        )}

        {/* Entity link badge — numbered like the sound card entity buttons */}
        {iterationLink?.entityNodeId && (
          <span
            title={`Linked: ${iterationLink.entityNodeId}`}
            style={{
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.65)',
              borderRadius: '2px',
              padding: '1px 2px',
              flexShrink: 0,
              fontSize: '7px',
              fontWeight: 700,
              lineHeight: 1,
              color: 'rgba(255,255,255,0.92)',
            }}
          >
            {iterationLink.entityIndex !== undefined ? iterationLink.entityIndex + 1 : ''}
          </span>
        )}

        {/* Context-menu trigger + delete — shown only on hover */}
        {isHovered && (
          <>

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
          </>
        )}
      </div>
    </div>
  );
}


