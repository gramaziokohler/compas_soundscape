'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FLOATING_WINDOW } from '@/utils/constants';

export interface FloatingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which edges a resize gesture moves (e.g. top-left = { n: true, w: true }). */
export interface ResizeEdges {
  n?: boolean;
  s?: boolean;
  e?: boolean;
  w?: boolean;
}

interface UseFloatingWindowOptions {
  /** localStorage key the geometry is persisted under. */
  storageKey: string;
  defaultSize: { w: number; h: number };
  /** Only initialise/track while the window is open. */
  active: boolean;
}

const { MIN_SIZE, VIEWPORT_MARGIN } = FLOATING_WINDOW;

function clampRect(r: FloatingRect): FloatingRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.w, MIN_SIZE.w), vw);
  const h = Math.min(Math.max(r.h, MIN_SIZE.h), vh);
  const x = Math.min(Math.max(r.x, VIEWPORT_MARGIN - w), vw - VIEWPORT_MARGIN);
  const y = Math.min(Math.max(r.y, 0), vh - VIEWPORT_MARGIN);
  return { x, y, w, h };
}

function loadRect(key: string): FloatingRect | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FloatingRect>;
    if ([p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return p as FloatingRect;
    }
  } catch { /* storage unavailable or corrupt — fall back to default */ }
  return null;
}

function saveRect(key: string, rect: FloatingRect): void {
  try {
    localStorage.setItem(key, JSON.stringify(rect));
  } catch { /* storage unavailable */ }
}

function centeredRect(size: { w: number; h: number }): FloatingRect {
  const w = Math.min(size.w, window.innerWidth * 0.92);
  const h = Math.min(size.h, window.innerHeight * 0.88);
  return { w, h, x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2 };
}

/**
 * Drag + resize + persisted geometry for a fixed-position floating window.
 *
 * Usage:
 * ```tsx
 * const { rect, startDrag, startResize } = useFloatingWindow({ storageKey, defaultSize, active });
 * <div style={{ position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
 *   <header onPointerDown={startDrag} />
 * </div>
 * ```
 * `rect` is null until the window opens (first render), then restored from
 * localStorage (clamped to the current viewport) or centered.
 */
export function useFloatingWindow({ storageKey, defaultSize, active }: UseFloatingWindowOptions) {
  const [rect, setRect] = useState<FloatingRect | null>(null);
  const rectRef = useRef<FloatingRect | null>(null);
  rectRef.current = rect;

  useEffect(() => {
    if (!active) return;
    setRect(clampRect(loadRect(storageKey) ?? centeredRect(defaultSize)));
  }, [active, storageKey, defaultSize]);

  // Keep the window reachable when the viewport shrinks.
  useEffect(() => {
    if (!active) return;
    const onResize = () => setRect((r) => (r ? clampRect(r) : r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  const beginGesture = useCallback(
    (e: ReactPointerEvent, compute: (start: FloatingRect, dx: number, dy: number) => FloatingRect) => {
      const start = rectRef.current;
      if (!start || e.button !== 0) return;
      e.preventDefault();
      const originX = e.clientX;
      const originY = e.clientY;
      const onMove = (ev: PointerEvent) => {
        setRect(clampRect(compute(start, ev.clientX - originX, ev.clientY - originY)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (rectRef.current) saveRect(storageKey, rectRef.current);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [storageKey],
  );

  /** Attach to the title bar; ignores presses that start on buttons. */
  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      beginGesture(e, (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    },
    [beginGesture],
  );

  const startResize = useCallback(
    (edges: ResizeEdges) => (e: ReactPointerEvent) => {
      e.stopPropagation();
      beginGesture(e, (s, dx, dy) => {
        let { x, y, w, h } = s;
        if (edges.e) w = s.w + dx;
        if (edges.s) h = s.h + dy;
        if (edges.w) {
          w = Math.max(s.w - dx, MIN_SIZE.w);
          x = s.x + (s.w - w);
        }
        if (edges.n) {
          h = Math.max(s.h - dy, MIN_SIZE.h);
          y = s.y + (s.h - h);
        }
        return { x, y, w, h };
      });
    },
    [beginGesture],
  );

  return { rect, startDrag, startResize };
}
