/**
 * Layout math for Simple-mode bubble columns (Soundscapes / Acoustics / Listeners).
 *
 * A column is `[▲] bubbles… [▼] [+]`: the arrows only exist while the column
 * overflows its vertical budget, and then both are always laid out (disabled at
 * the ends) so the "+" never jumps while scrolling.
 */
import { SIMPLE_MODE } from '@/utils/constants';

const SLOT = SIMPLE_MODE.BUBBLE_SIZE + SIMPLE_MODE.BUBBLE_GAP;
const ARROW_SLOT = SIMPLE_MODE.SCROLL_BUTTON_HEIGHT + SIMPLE_MODE.BUBBLE_GAP;

export interface BubbleWindowLayout {
  /** More bubbles than the budget holds — arrows are shown. */
  overflow: boolean;
  /** Bubbles rendered at once (≥ 1 when there is any bubble). */
  visibleSlots: number;
}

/** Height in px of a column rendering `visible` bubbles + the "+" (and arrows when overflowing). */
export function columnHeight(visible: number, overflow: boolean): number {
  return visible * SLOT + SIMPLE_MODE.BUBBLE_SIZE + (overflow ? 2 * ARROW_SLOT : 0);
}

/** Smallest height an overflowing column can shrink to (one bubble, two arrows, "+"). */
export const MIN_OVERFLOW_COLUMN_HEIGHT = columnHeight(1, true);

/** How many of `count` bubbles fit in `availablePx`. */
export function windowLayout(count: number, availablePx: number): BubbleWindowLayout {
  if (columnHeight(count, false) <= availablePx) return { overflow: false, visibleSlots: count };
  const room = availablePx - columnHeight(0, true);
  return { overflow: true, visibleSlots: Math.min(count, Math.max(1, Math.floor(room / SLOT))) };
}

/** Clamp a first-visible index into `[0, count - visibleSlots]`. */
export function clampScroll(index: number, count: number, visibleSlots: number): number {
  return Math.max(0, Math.min(index, count - visibleSlots));
}

/** Minimal scroll change that brings item `target` into the window starting at `current`. */
export function scrollToInclude(current: number, target: number, visibleSlots: number): number {
  if (target < current) return target;
  if (target >= current + visibleSlots) return target - visibleSlots + 1;
  return current;
}

/**
 * Share the right edge between Acoustics (top-down) and Listeners (bottom-up).
 * Both fit → each gets its full height. Otherwise the space is split in
 * proportion to need (never below one overflowing bubble each), and a column
 * that needs less than its share hands the rest to the other.
 */
export function splitRightBudget(
  availablePx: number,
  acousticsCount: number,
  listenersCount: number,
): { acoustics: number; listeners: number } {
  const needA = columnHeight(acousticsCount, false);
  const needL = columnHeight(listenersCount, false);
  if (needA + needL <= availablePx) return { acoustics: needA, listeners: needL };
  let a = Math.min(needA, Math.max(MIN_OVERFLOW_COLUMN_HEIGHT, (availablePx * needA) / (needA + needL)));
  let l = availablePx - a;
  if (l > needL) {
    l = needL;
    a = availablePx - l;
  }
  return { acoustics: a, listeners: Math.max(l, MIN_OVERFLOW_COLUMN_HEIGHT) };
}
