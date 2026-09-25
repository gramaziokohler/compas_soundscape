'use client';

import { useRef, useState, useCallback, useEffect, memo } from 'react';
import { API_BASE_URL } from '@/utils/constants';
import { subscribeColorTheme } from '@/utils/color-theme';
import { Spinner } from '@/components/ui/Spinner';
import { getAudioPeaks, type AudioPeaks } from '@/lib/audio/peaks-cache';
import { drawSilhouettePath } from '@/lib/audio/waveform-silhouette';
import type { IterationLink } from '@/types/audio';

function waveformColor(muted: boolean): string {
  const styles = getComputedStyle(document.documentElement);
  return styles.getPropertyValue(muted ? '--color-border-strong' : '--color-secondary-hover').trim();
}

/** Draws a static waveform thumbnail from cached min/max peaks on a plain canvas. */
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

      // Continuous filled silhouette spanning every amplitude edge (no border).
      const n = peaks.min.length;
      const mid = heightPx / 2;
      let globalPeak = 1e-6;
      for (let i = 0; i < n; i++) {
        const mx = peaks.max[i] ?? 0;
        const mn = peaks.min[i] ?? 0;
        if (mx > globalPeak) globalPeak = mx;
        if (-mn > globalPeak) globalPeak = -mn;
      }
      const scale = mid / globalPeak;
      const top = new Float32Array(widthPx);
      const bottom = new Float32Array(widthPx);
      for (let x = 0; x < widthPx; x++) {
        const peakIdx = Math.min(n - 1, Math.floor(((x + 0.5) / widthPx) * n));
        const mx = peaks.max[peakIdx] ?? 0;
        const mn = peaks.min[peakIdx] ?? 0;
        top[x] = mid - mx * scale;
        bottom[x] = mid - mn * scale;
      }
      drawSilhouettePath(ctx, widthPx, top, bottom, color);
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

export interface DAWClipProps {
  clipKey: string;
  startMs: number;
  durationMs: number;
  pxPerSecond: number;
  audioUrl?: string;
  color: string;
  name: string;
  isMuted: boolean;
  isDraggable: boolean;
  isSelected: boolean;
  isOverlapping: boolean;
  isDragging: boolean;
  isDuplicating: boolean;
  /** Live delta (ms) applied while this clip is part of an in-progress drag; 0 otherwise. */
  previewOffsetMs: number;
  timelineDurationMs: number;
  iterationLink?: IterationLink;
  /** Solver-excluded ghost clip: shown hatched, never played. */
  isExcluded?: boolean;
  excludedReason?: string;
  onPointerDownClip: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDelete: () => void;
  onDoubleClick?: () => void;
  onContextMenu: (x: number, y: number) => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
}

function DAWClipImpl({
  clipKey,
  startMs,
  durationMs,
  pxPerSecond,
  audioUrl,
  color,
  name,
  isMuted,
  isDraggable,
  isSelected,
  isOverlapping,
  isDragging,
  isDuplicating,
  previewOffsetMs,
  timelineDurationMs,
  iterationLink,
  isExcluded,
  excludedReason,
  onPointerDownClip,
  onDelete,
  onDoubleClick,
  onContextMenu,
  onHover,
  onHoverEnd,
}: DAWClipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [peaks, setPeaks] = useState<AudioPeaks | null>(null);

  const effectiveStartMs = startMs + previewOffsetMs;
  const leftPx = (effectiveStartMs / 1000) * pxPerSecond;
  const clippedEndMs = Math.min(effectiveStartMs + durationMs, timelineDurationMs);
  const clippedWidthMs = Math.max(clippedEndMs - Math.max(effectiveStartMs, 0), 0);
  const widthPx = Math.max((clippedWidthMs / 1000) * pxPerSecond, 4);

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

  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => subscribeColorTheme(() => setThemeVersion((v) => v + 1)), []);

  const handleContextMenuEvt = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  const interactive = isSelected || isHovered;
  const interactiveWidth = isSelected ? '1.5px' : '1px';
  const interactiveBorder = `${interactiveWidth} solid ${
    isSelected ? 'var(--color-primary)' : isMuted ? 'rgba(150,150,150,0.4)' : color
  }`;
  const lateralBorder = `1px solid ${
    isMuted ? 'rgba(150,150,150,0.4)' : isOverlapping ? `${color}55` : color
  }`;

  return (
    <div
      onPointerDown={onPointerDownClip}
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenuEvt}
      onMouseEnter={() => { setIsHovered(true); onHover?.(); }}
      onMouseLeave={() => { setIsHovered(false); onHoverEnd?.(); }}
      title={isExcluded ? `${name} — excluded: ${excludedReason ?? 'timing link could not be satisfied'}` : name}
      style={{
        position: 'absolute',
        left: `${leftPx}px`,
        top: '4px',
        width: `${widthPx}px`,
        height: 'calc(100% - 8px)',
        backgroundColor: isMuted ? 'rgba(100,100,100,0.35)' : isOverlapping ? `${color}80` : `${color}bb`,
        borderRadius: '3px',
        borderTop: interactive ? interactiveBorder : 'none',
        borderBottom: interactive ? interactiveBorder : 'none',
        borderLeft: interactive ? interactiveBorder : lateralBorder,
        borderRight: interactive ? interactiveBorder : lateralBorder,
        boxShadow: isSelected ? '0 0 0 1.5px var(--color-primary)' : 'none',
        cursor: isDraggable
          ? isDragging
            ? isDuplicating ? 'copy' : 'grabbing'
            : 'grab'
          : 'pointer',
        overflow: 'hidden',
        boxSizing: 'border-box',
        transition: isDragging ? 'none' : 'opacity 0.1s',
        opacity: isDragging ? 0.8 : 1,
        zIndex: isDragging ? 30 : isSelected ? 12 : 10,
        userSelect: 'none',
        outline: isDragging && isDuplicating ? `2px dashed ${color}` : 'none',
        ...(isExcluded
          ? {
              backgroundColor: 'color-mix(in srgb, var(--color-error) 20%, transparent)',
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--color-error) 0, var(--color-error) 1px, transparent 1px, transparent 6px)',
              borderTop: '1px dashed var(--color-error)',
              borderBottom: '1px dashed var(--color-error)',
              borderLeft: '1px dashed var(--color-error)',
              borderRight: '1px dashed var(--color-error)',
              cursor: 'not-allowed',
              opacity: 0.9,
            }
          : {}),
      }}
      data-clip-key={clipKey}
    >
      <div style={{ width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.75 }}>
        {peaks && <PeaksCanvas key={themeVersion} peaks={peaks} color={waveformColor(isMuted)} />}
      </div>

      {isLoadingWaveform && !isExcluded && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', pointerEvents: 'none', zIndex: 20,
          }}
        >
          <span style={{ display: 'flex', color: 'rgba(255,255,255,0.85)' }}>
            <Spinner size={12} />
          </span>
        </div>
      )}

      {isExcluded && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', pointerEvents: 'none', zIndex: 20,
          }}
        >
          <span
            style={{
              fontSize: '8px', fontWeight: 700, lineHeight: 1, color: 'var(--color-error)',
              backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: '2px', padding: '1px 3px',
            }}
          >
            !
          </span>
        </div>
      )}

      <div
        style={{
          position: 'absolute', top: 2, right: 2, display: 'flex', gap: '2px',
          alignItems: 'center', zIndex: 31,
        }}
      >
        {iterationLink?.variantIndex !== undefined && (
          <span
            title={`Variant ${String.fromCharCode(65 + iterationLink.variantIndex)}`}
            style={{
              pointerEvents: 'none', fontSize: '7px', fontWeight: 700, lineHeight: 1,
              color: 'rgba(255,255,255,0.92)', backgroundColor: 'rgba(0,0,0,0.65)',
              borderRadius: '2px', padding: '1px 2px', flexShrink: 0,
            }}
          >
            {String.fromCharCode(65 + iterationLink.variantIndex)}
          </span>
        )}

        {iterationLink?.entityNodeId && (
          <span
            title={`Linked: ${iterationLink.entityNodeId}`}
            style={{
              pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: '2px', padding: '1px 2px',
              flexShrink: 0, fontSize: '7px', fontWeight: 700, lineHeight: 1, color: 'rgba(255,255,255,0.92)',
            }}
          >
            {iterationLink.entityIndex !== undefined ? iterationLink.entityIndex + 1 : ''}
          </span>
        )}

        {isHovered && !isExcluded && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              width: 13, height: 13, borderRadius: '2px', backgroundColor: 'var(--color-error)',
              border: 'none', color: 'white', fontSize: '9px', cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0,
            }}
            title="Remove clip"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export const DAWClip = memo(DAWClipImpl);
