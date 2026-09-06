'use client';

import { useRef, useState, useCallback, useEffect, memo } from 'react';
import { API_BASE_URL } from '@/utils/constants';
import { subscribeColorTheme } from '@/utils/color-theme';
import { Spinner } from '@/components/ui/Spinner';
import { getAudioPeaks, type AudioPeaks } from '@/lib/audio/peaks-cache';
import type { IterationLink } from '@/types/audio';

export interface IterationContextMenuData {
  x: number;
  y: number;
  iterationIndex: number;
}

function waveformColor(muted: boolean): string {
  const styles = getComputedStyle(document.documentElement);
  return styles.getPropertyValue(muted ? '--color-border-strong' : '--color-secondary-hover').trim();
}

/**
 * Draws a static waveform thumbnail from cached min/max peaks on a plain canvas.
 * Replaces mounting a full WaveSurfer instance per DAW block — this block never
 * plays audio, it only visualizes it, so it doesn't need a decoder/audio graph/
 * plugin system, just pixels.
 */
function PeaksCanvas({ peaks, color }: { peaks: AudioPeaks; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const widthPx = container.clientWidth;
      const heightPx = container.clientHeight;
      if (widthPx <= 0 || heightPx <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(widthPx * dpr));
      canvas.height = Math.max(1, Math.round(heightPx * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, widthPx, heightPx);
      ctx.fillStyle = color;

      const mid = heightPx / 2;
      const n = peaks.min.length;
      const barWidth = 2;
      const barGap = 1;
      const step = barWidth + barGap;
      const barsToShow = Math.max(1, Math.floor(widthPx / step));

      for (let i = 0; i < barsToShow; i++) {
        const peakIdx = Math.min(n - 1, Math.floor((i / barsToShow) * n));
        const max = peaks.max[peakIdx] ?? 0;
        const min = peaks.min[peakIdx] ?? 0;
        const y1 = mid - max * mid;
        const y2 = mid - min * mid;
        ctx.fillRect(i * step, y1, barWidth, Math.max(1, y2 - y1));
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [peaks, color]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
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

function DAWIterationImpl({
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
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [dragOffsetMs, setDragOffsetMs] = useState(0);
  // Real React state (not just a ref) so drag visuals — grabbing cursor, dashed
  // copy outline, reduced opacity — actually appear during the gesture instead of
  // only incidentally when some other state change happens to trigger a re-render.
  const [isDragging, setIsDragging] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const isDraggingRef = useRef(false);
  const isDuplicatingRef = useRef(false);
  const startXRef = useRef(0);
  const dragOffsetMsRef = useRef(0);
  const [peaks, setPeaks] = useState<AudioPeaks | null>(null);

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

  // ── Waveform peaks (cached — decoded once per URL, never per block) ────────
  useEffect(() => {
    if (!audioUrl) {
      setPeaks(null);
      return;
    }
    const resolvedUrl =
      audioUrl.startsWith('blob:') || audioUrl.startsWith('http')
        ? audioUrl
        : `${API_BASE_URL}${audioUrl}`;

    let active = true;
    setIsLoadingWaveform(true);
    setPeaks(null);

    getAudioPeaks(audioUrl, resolvedUrl).then((result) => {
      if (!active) return;
      setPeaks(result);
      setIsLoadingWaveform(false);
    });

    return () => {
      active = false;
    };
  }, [audioUrl]);

  // Re-render the canvas on theme change (color tokens flip in dark mode).
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => subscribeColorTheme(() => setThemeVersion((v) => v + 1)), []);

  // ── Pointer drag / duplicate ───────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggable) return;
      if (e.button === 2) return; // right-click handled separately
      e.preventDefault();
      e.stopPropagation();

      // Pointer capture: this element keeps receiving move/up events for this
      // pointer even if it leaves the element's bounds (fast drag, or the block
      // shrinking under the cursor), and capture is released automatically on
      // pointerup — eliminating the "pointer escaped the window listener target
      // mid-drag and the block gets stuck in drag state" failure mode that plain
      // `window.addEventListener` was prone to.
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      isDraggingRef.current = true;
      isDuplicatingRef.current = e.ctrlKey || e.metaKey;
      startXRef.current = e.clientX;
      dragOffsetMsRef.current = 0;
      setIsDragging(true);
      setIsDuplicating(isDuplicatingRef.current);

      const handleMove = (ev: PointerEvent) => {
        if (!isDraggingRef.current) return;
        const deltaMs = ((ev.clientX - startXRef.current) / pxPerSecond) * 1000;
        const newStart = clampToFree(startMs + deltaMs);
        dragOffsetMsRef.current = newStart - startMs;
        setDragOffsetMs(newStart - startMs);
      };

      const endDrag = (ev: PointerEvent) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        const finalDelta = dragOffsetMsRef.current;
        const isDup = isDuplicatingRef.current;
        setDragOffsetMs(0);
        dragOffsetMsRef.current = 0;
        setIsDragging(false);
        setIsDuplicating(false);
        try { target.releasePointerCapture(ev.pointerId); } catch { /* already released */ }

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
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', endDrag);
        target.removeEventListener('pointercancel', endDrag);
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', endDrag);
      target.addEventListener('pointercancel', endDrag);
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
          ? isDragging
            ? isDuplicating ? 'copy' : 'grabbing'
            : 'grab'
          : 'pointer',
        overflow: 'hidden',
        boxSizing: 'border-box',
        transition: isDragging ? 'none' : 'opacity 0.1s',
        opacity: isDragging ? 0.8 : 1,
        zIndex: isDragging ? 30 : 10,
        userSelect: 'none',
        outline:
          isDragging && isDuplicating
            ? `2px dashed ${color}`
            : 'none',
      }}
    >
      {/* Waveform — drawn from cached peaks, no per-block decode */}
      <div style={{ width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.75 }}>
        {peaks && <PeaksCanvas key={themeVersion} peaks={peaks} color={waveformColor(isMuted)} />}
      </div>

      {/* Loading overlay while the saved audio WAV streams in */}
      {isLoadingWaveform && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          <span style={{ display: 'flex', color: 'rgba(255,255,255,0.85)' }}>
            <Spinner size={12} />
          </span>
        </div>
      )}

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

/**
 * Memoized: with the peaks cache in place, the remaining re-render cost is
 * cheap layout/paint, but avoiding it entirely for blocks whose props are
 * referentially unchanged (siblings array size aside) still helps once a
 * track has many iterations.
 */
export const DAWIteration = memo(DAWIterationImpl);


