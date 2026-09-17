'use client';

import { useCallback, useRef, useState } from 'react';
import { DAW } from '@/utils/constants';

const TICK_LADDER = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60] as const;

/** Adaptive label step (seconds): first ladder step whose pixel width is >= 60px. */
export function computeTickStep(pxPerSecond: number): number {
  for (const step of TICK_LADDER) {
    if (step * pxPerSecond >= 60) return step;
  }
  return TICK_LADDER[TICK_LADDER.length - 1];
}

function computeMinorStep(labelStep: number): number {
  const idx = TICK_LADDER.indexOf(labelStep as (typeof TICK_LADDER)[number]);
  return idx > 0 ? TICK_LADDER[idx - 1] : labelStep;
}

function formatTime(totalSec: number, subSecond: boolean): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (subSecond) return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}

export interface LoopRegion {
  startMs: number;
  endMs: number;
}

interface DAWRulerProps {
  totalDurationSec: number;
  pxPerSecond: number;
  onSeek: (timeMs: number) => void;
  loopRegion: LoopRegion | null;
  onLoopRegionChange: (region: LoopRegion | null) => void;
  onEditDuration?: () => void;
  /** Some clips of the current sound scene start beyond this timeline length. */
  hasOverrun?: boolean;
}

export function DAWRuler({ totalDurationSec, pxPerSecond, onSeek, loopRegion, onLoopRegionChange, onEditDuration, hasOverrun = false }: DAWRulerProps) {
  const labelStep = computeTickStep(pxPerSecond);
  const minorStep = computeMinorStep(labelStep);
  const subSecond = labelStep < 1;

  const ticks: { x: number; label: string; isPrimary: boolean }[] = [];
  for (let t = 0; t <= totalDurationSec + 0.001; t += minorStep) {
    const isPrimary = Math.abs(Math.round(t / labelStep) * labelStep - t) < minorStep / 2;
    ticks.push({ x: t * pxPerSecond, label: formatTime(t, subSecond), isPrimary });
  }

  const dragRef = useRef<{ isLoop: boolean; startSec: number } | null>(null);
  const previewRef = useRef<LoopRegion | null>(null);
  const [dragLoopPreview, setDragLoopPreview] = useState<LoopRegion | null>(null);

  const xToSec = useCallback((clientX: number, rect: DOMRect) => {
    const localX = clientX - rect.left - DAW.HEAD_WIDTH;
    return Math.max(0, localX / pxPerSecond);
  }, [pxPerSecond]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const startSec = xToSec(e.clientX, rect);
    if (startSec < 0) return;
    const isLoop = e.shiftKey;
    dragRef.current = { isLoop, startSec };
    if (!isLoop) {
      onSeek(startSec * 1000);
    } else {
      onLoopRegionChange(null);
      const initial = { startMs: startSec * 1000, endMs: startSec * 1000 };
      previewRef.current = initial;
      setDragLoopPreview(initial);
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const curSec = xToSec(ev.clientX, rect);
      if (drag.isLoop) {
        const lo = Math.min(drag.startSec, curSec);
        const hi = Math.max(drag.startSec, curSec);
        const region = { startMs: lo * 1000, endMs: hi * 1000 };
        previewRef.current = region;
        setDragLoopPreview(region);
      } else {
        onSeek(curSec * 1000);
      }
    };
    const handleUp = () => {
      const drag = dragRef.current;
      if (drag?.isLoop) {
        const preview = previewRef.current;
        if (preview && preview.endMs - preview.startMs > 50) onLoopRegionChange(preview);
        previewRef.current = null;
        setDragLoopPreview(null);
      }
      dragRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [xToSec, onSeek, onLoopRegionChange]);

  const activeLoop = dragLoopPreview ?? loopRegion;

  return (
    <div
      onPointerDown={handlePointerDown}
      style={{
        position: 'sticky', top: 0, zIndex: 20, display: 'flex', height: `${DAW.RULER_HEIGHT}px`,
        flexShrink: 0, borderBottom: '1px solid var(--color-border-strong)',
        cursor: 'crosshair', userSelect: 'none', minWidth: DAW.HEAD_WIDTH + totalDurationSec * pxPerSecond,
      }}
      title="Drag to seek — Shift+drag to set a loop region"
    >
      {/* Frosted backdrop — tracks scrolling vertically behind the sticky ruler
          are hidden behind the same glass treatment as the dock. */}
      <div
        aria-hidden="true"
        className="backdrop-blur-lg backdrop-saturate-150"
        style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}
      />
      <div
        style={{
          width: `${DAW.HEAD_WIDTH}px`, flexShrink: 0, borderRight: '1px solid var(--color-border-strong)',
          position: 'sticky', left: 0, zIndex: 21,
        }}
      />
      <div style={{ position: 'relative', flex: 1 }}>
        {activeLoop && (
          <div
            style={{
              position: 'absolute', left: `${(activeLoop.startMs / 1000) * pxPerSecond}px`, top: 0, height: '100%',
              width: `${((activeLoop.endMs - activeLoop.startMs) / 1000) * pxPerSecond}px`,
              backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent)',
              borderLeft: '1px solid var(--color-primary)', borderRight: '1px solid var(--color-primary)',
              pointerEvents: 'none',
            }}
          />
        )}
        {ticks.map(({ x, label, isPrimary }, i) => {
          const isLast = i === ticks.length - 1;
          return (
            <div key={x} style={{ position: 'absolute', left: `${x}px`, top: 0, height: '100%' }}>
              <div
                style={{
                  position: 'absolute', bottom: 0, left: 0, width: '1px',
                  height: isPrimary ? '100%' : '40%',
                  backgroundColor: isPrimary ? 'var(--color-secondary-hover)' : 'var(--color-secondary-light)',
                }}
              />
              {isPrimary && (
                <span
                  style={{
                    position: 'absolute', top: '3px',
                    ...(isLast ? { right: '0px', textAlign: 'right' as const } : { left: '3px' }),
                    fontSize: '9px', color: 'var(--color-secondary-hover)', fontFamily: 'monospace',
                    lineHeight: 1, pointerEvents: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </span>
              )}
            </div>
          );
        })}
        {onEditDuration && (
          <button
            onClick={(e) => { e.stopPropagation(); onEditDuration(); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={hasOverrun ? 'Some clips extend beyond the timeline — edit duration to include them' : 'Edit timeline duration'}
            style={{
              position: 'absolute', left: `${totalDurationSec * pxPerSecond + 6}px`, top: '50%',
              transform: 'translateY(-50%)', width: 16, height: 16, borderRadius: '3px', border: 'none',
              background: 'transparent', color: hasOverrun ? 'var(--color-warning)' : 'var(--color-secondary-hover)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          >
            {hasOverrun && (
              <span style={{ position: 'absolute', top: -2, right: -2, width: 5, height: 5, borderRadius: '50%', backgroundColor: 'var(--color-warning)' }} />
            )}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
