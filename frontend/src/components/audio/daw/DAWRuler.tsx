'use client';

import { useCallback, useRef, useState } from 'react';
import { NumberField } from '@/components/ui/NumberField';
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
  /** Inline timeline-duration editor at the ruler's end (pencil button). */
  isEditingDuration: boolean;
  onStartEditDuration: () => void;
  onStopEditDuration: () => void;
  onDurationChange: (ms: number) => void;
  /** Duration (ms) that would include every clip beyond the timeline; null when everything fits. */
  overrunProposedMs?: number | null;
  onExtendTimeline?: () => void;
  /** Orchestrate schedule is being recomputed — shown in the ruler's head cell. */
  isBakingSchedule?: boolean;
}

export function DAWRuler({
  totalDurationSec, pxPerSecond, onSeek, loopRegion, onLoopRegionChange,
  isEditingDuration, onStartEditDuration, onStopEditDuration, onDurationChange,
  overrunProposedMs = null, onExtendTimeline, isBakingSchedule = false,
}: DAWRulerProps) {
  const labelStep = computeTickStep(pxPerSecond);
  const minorStep = computeMinorStep(labelStep);
  const subSecond = labelStep < 1;

  const ticks: { x: number; label: string; isPrimary: boolean }[] = [];
  for (let t = 0; t <= totalDurationSec + 0.001; t += minorStep) {
    const isPrimary = Math.abs(Math.round(t / labelStep) * labelStep - t) < minorStep / 2;
    ticks.push({ x: t * pxPerSecond, label: formatTime(t, subSecond), isPrimary });
  }

  const dragRef = useRef<{ isLoop: boolean; startSec: number; startX: number } | null>(null);
  const previewRef = useRef<LoopRegion | null>(null);
  const [dragLoopPreview, setDragLoopPreview] = useState<LoopRegion | null>(null);

  const rulerRef = useRef<HTMLDivElement>(null);

  const xToSec = useCallback((clientX: number, rect: DOMRect) => {
    const localX = clientX - rect.left - DAW.HEAD_WIDTH;
    return Math.max(0, localX / pxPerSecond);
  }, [pxPerSecond]);

  /** Drag one edge of the committed loop region; the other edge stays fixed (edges may cross). */
  const handleLoopEdgePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, edge: 'start' | 'end') => {
    if (e.button !== 0 || !loopRegion || !rulerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = rulerRef.current.getBoundingClientRect();
    const fixedSec = (edge === 'start' ? loopRegion.endMs : loopRegion.startMs) / 1000;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
      const curSec = Math.min(totalDurationSec, xToSec(ev.clientX, rect));
      const region = { startMs: Math.min(fixedSec, curSec) * 1000, endMs: Math.max(fixedSec, curSec) * 1000 };
      previewRef.current = region;
      setDragLoopPreview(region);
    };
    const handleUp = () => {
      const preview = previewRef.current;
      if (preview && preview.endMs - preview.startMs > DAW.MIN_LOOP_REGION_MS) onLoopRegionChange(preview);
      previewRef.current = null;
      setDragLoopPreview(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [loopRegion, totalDurationSec, xToSec, onLoopRegionChange]);

  // Click seeks; dragging past the threshold draws a new loop region instead.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const startSec = xToSec(e.clientX, rect);
    dragRef.current = { isLoop: false, startSec, startX: e.clientX };
    onSeek(startSec * 1000);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.isLoop) {
        if (Math.abs(ev.clientX - drag.startX) < DAW.RULER_LOOP_DRAG_THRESHOLD_PX) return;
        drag.isLoop = true;
      }
      const curSec = xToSec(ev.clientX, rect);
      const lo = Math.min(drag.startSec, curSec);
      const hi = Math.max(drag.startSec, curSec);
      const region = { startMs: lo * 1000, endMs: hi * 1000 };
      previewRef.current = region;
      setDragLoopPreview(region);
    };
    const handleUp = () => {
      const drag = dragRef.current;
      if (drag?.isLoop) {
        const preview = previewRef.current;
        if (preview && preview.endMs - preview.startMs > DAW.MIN_LOOP_REGION_MS) onLoopRegionChange(preview);
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

  /** Double-clicking inside the loop region removes it. */
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!loopRegion) return;
    const ms = xToSec(e.clientX, e.currentTarget.getBoundingClientRect()) * 1000;
    if (ms >= loopRegion.startMs && ms <= loopRegion.endMs) onLoopRegionChange(null);
  }, [loopRegion, xToSec, onLoopRegionChange]);

  const activeLoop = dragLoopPreview ?? loopRegion;

  return (
    <div
      ref={rulerRef}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'sticky', top: 0, zIndex: 20, display: 'flex', height: `${DAW.RULER_HEIGHT}px`,
        flexShrink: 0, borderBottom: '1px solid var(--color-border-strong)',
        cursor: 'crosshair', userSelect: 'none', minWidth: DAW.HEAD_WIDTH + totalDurationSec * pxPerSecond,
      }}
      title="Click to seek — drag to set a loop region — drag its edges to resize — double-click the loop to remove it"
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
          display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 'var(--card-space-md)',
          fontSize: '9px', color: 'var(--color-secondary-hover)',
        }}
      >
        {isBakingSchedule && (
          <>
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--color-primary)',
                animation: 'daw-bake-pulse 1s ease-in-out infinite',
              }}
            />
            Computing schedule…
            <style>{`@keyframes daw-bake-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.7); } }`}</style>
          </>
        )}
      </div>
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
        {/* Edge handles — resize the committed loop region (also while resizing it). */}
        {loopRegion && activeLoop && (['start', 'end'] as const).map((edge) => (
          <div
            key={edge}
            onPointerDown={(e) => handleLoopEdgePointerDown(e, edge)}
            title={edge === 'start' ? 'Drag to move the loop start' : 'Drag to move the loop end'}
            style={{
              position: 'absolute', top: 0, height: '100%', zIndex: 2, cursor: 'ew-resize',
              width: `${DAW.LOOP_HANDLE_HIT_PX}px`,
              left: `${((edge === 'start' ? activeLoop.startMs : activeLoop.endMs) / 1000) * pxPerSecond - DAW.LOOP_HANDLE_HIT_PX / 2}px`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: `${DAW.LOOP_HANDLE_GRIP_WIDTH_PX}px`, height: `${DAW.LOOP_HANDLE_GRIP_HEIGHT_PX}px`,
                borderRadius: '2px', backgroundColor: 'var(--color-primary)', pointerEvents: 'none',
              }}
            />
          </div>
        ))}
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
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', left: `${totalDurationSec * pxPerSecond + DAW.RULER_END_CONTROL_GAP}px`, top: '50%',
            transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {isEditingDuration ? (
            <NumberField
              value={totalDurationSec}
              precision={0}
              autoFocus
              onCommit={(v) => { if (v && v > 0) onDurationChange(v * 1000); onStopEditDuration(); }}
              onKeyDown={(e) => { if (e.key === 'Escape') onStopEditDuration(); }}
              containerStyle={{ width: '44px' }}
              className="!text-xs !py-0.5"
            />
          ) : (
            <button
              onClick={onStartEditDuration}
              title="Edit timeline duration (seconds)"
              style={{
                width: DAW.RULER_EDIT_BUTTON_SIZE, height: DAW.RULER_EDIT_BUTTON_SIZE,
                borderRadius: '3px', border: 'none', background: 'transparent',
                color: 'var(--color-secondary-hover)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
          )}
          {overrunProposedMs !== null && onExtendTimeline && !isEditingDuration && (
            <button
              onClick={onExtendTimeline}
              title="Some clips start beyond the timeline — extend it to include them"
              style={{
                border: '1px solid var(--color-warning)', borderRadius: '3px', background: 'transparent',
                color: 'var(--color-warning)', cursor: 'pointer', fontSize: '9px', lineHeight: 1,
                padding: '2px 4px', whiteSpace: 'nowrap',
              }}
            >
              Extend to {formatTime(overrunProposedMs / 1000, false)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
