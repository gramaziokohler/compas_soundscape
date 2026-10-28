'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import { clampToViewport } from '@/utils/scale';
import { POPUP_MENU } from '@/utils/constants';

export interface ViewportPosition {
  x: number;
  y: number;
}

/**
 * useViewportClampedPosition Hook
 *
 * Keeps a `position: fixed` popup opened at a viewport point (x, y) fully on
 * screen: near the bottom/right edge it is shifted up/left by its measured size.
 * Re-measures after every render, so content that grows while open (an accordion
 * row) re-clamps too. Returns null while the element is unmounted or not yet
 * measured — render the popup invisible until then (the layout effect runs
 * before paint, so there is no flash).
 *
 * Usage:
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * const pos = useViewportClampedPosition(ref, menu.x, menu.y);
 * <div ref={ref} style={{ position: 'fixed', left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, opacity: pos ? 1 : 0 }} />
 * ```
 */
export function useViewportClampedPosition(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  margin: number = POPUP_MENU.VIEWPORT_MARGIN,
): ViewportPosition | null {
  const [pos, setPos] = useState<ViewportPosition | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setPos((prev) => (prev === null ? prev : null));
      return;
    }
    const next = clampToViewport(x, y, el.offsetWidth, el.offsetHeight, margin);
    setPos((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
  });

  return pos;
}
