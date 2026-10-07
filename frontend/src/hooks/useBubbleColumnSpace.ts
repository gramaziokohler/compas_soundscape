'use client';

import { useEffect, useState } from 'react';
import { useUIStore } from '@/store';
import { SCENE_BOTTOM_BAR, SIMPLE_MODE } from '@/utils/constants';
import { splitRightBudget } from '@/utils/bubbleOverflow';

export interface BubbleColumnSpace {
  /** px available to the left (Soundscapes) column below its heading. */
  soundscapes: number;
  /** px available to the Acoustics column below its heading. */
  acoustics: number;
  /** px available to the Listeners column above the bottom bar / docked DAW. */
  listeners: number;
  /** Bottom offset (px) of the Listeners column — above the bottom bar and the docked DAW. */
  listenersBottom: number;
}

/** Window inner height; unbounded until mounted so the server render never shows arrows. */
function useViewportHeight(): number {
  const [height, setHeight] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}

/**
 * Vertical budgets of the Simple-mode bubble columns: the viewport minus the
 * headings, the bottom bar and the docked DAW. The two right columns share one
 * budget (split by `splitRightBudget`) so Acoustics and Listeners never collide.
 *
 * Usage:
 * ```tsx
 * const space = useBubbleColumnSpace();
 * <BubbleScrollColumn availablePx={space.acoustics} … />
 * ```
 */
export function useBubbleColumnSpace(): BubbleColumnSpace {
  const viewport = useViewportHeight();
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);
  const acousticsCount = useUIStore((s) => s.bubbleColumnCounts.acoustics);
  const listenersCount = useUIStore((s) => s.bubbleColumnCounts.listeners);

  const top = SIMPLE_MODE.TOP_OFFSET + SIMPLE_MODE.HEADING_HEIGHT;
  const listenersBottom = SCENE_BOTTOM_BAR.HEIGHT + SIMPLE_MODE.LISTENERS_BOTTOM_GAP + dockLift;
  const soundscapes = Math.max(0, viewport - top - listenersBottom);

  const rightTop = SIMPLE_MODE.RIGHT_TOP_OFFSET + SIMPLE_MODE.HEADING_HEIGHT;
  const rightAvailable = Math.max(
    0,
    viewport - rightTop - listenersBottom - SIMPLE_MODE.HEADING_HEIGHT - SIMPLE_MODE.RIGHT_COLUMNS_GAP,
  );
  const split = splitRightBudget(rightAvailable, acousticsCount, listenersCount);

  return { soundscapes, acoustics: split.acoustics, listeners: split.listeners, listenersBottom };
}
