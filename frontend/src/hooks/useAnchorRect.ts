'use client';

import { useEffect, useState } from 'react';

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function sameRect(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function measure(resolve: () => Element | null): AnchorRect | null {
  const el = resolve();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/**
 * Viewport rect of an element that may appear late or move (scrolling bubble
 * columns, the bottom bar lifted by the docked DAW, a button that only renders
 * once something is selected).
 *
 * Re-measures on window resize and every `pollMs` while `resolve` is set;
 * returns null while the element is missing (or `resolve` is null). Only
 * re-renders when the rect actually changes.
 *
 * Usage:
 * ```tsx
 * const rect = useAnchorRect(() => document.getElementById('play'), 250);
 * ```
 */
export function useAnchorRect(resolve: (() => Element | null) | null, pollMs: number): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    if (!resolve) {
      setRect(null);
      return;
    }
    const update = () => {
      const next = measure(resolve);
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    update();
    const timer = window.setInterval(update, pollMs);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, [resolve, pollMs]);

  return rect;
}
