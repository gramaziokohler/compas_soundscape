/**
 * Scrolls an element into view inside its nearest scrollable ancestor only.
 *
 * Unlike `el.scrollIntoView`, it never scrolls the page or other ancestors (the
 * sidebar shell, a floating BubblePanel, the DAW dock), and `align: 'start'`
 * puts a tall element's top edge in view instead of its bottom.
 *
 * Usage:
 * ```ts
 * scrollIntoContainer(cardEl, { align: 'start' });   // card header to the top
 * scrollIntoContainer(trackRow, { align: 'nearest' }); // minimal scroll
 * ```
 */
import { FOCUS_SCROLL } from '@/utils/constants';

export type ScrollAlign = 'start' | 'nearest';

export interface ScrollIntoContainerOptions {
  align?: ScrollAlign;
  /** px kept between the element and the container edge. */
  offset?: number;
  behavior?: ScrollBehavior;
}

/** Nearest scrollable (overflow-y auto / scroll / overlay) ancestor of a node. */
export function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Scrolls `el` into view within its scroll parent; returns false when there is none. */
export function scrollIntoContainer(
  el: HTMLElement | null,
  { align = 'start', offset = FOCUS_SCROLL.OFFSET_PX, behavior = 'smooth' }: ScrollIntoContainerOptions = {},
): boolean {
  const scroller = getScrollParent(el);
  if (!el || !scroller) return false;
  const box = scroller.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const topDelta = rect.top - box.top - offset;
  const bottomDelta = rect.bottom - box.bottom + offset;

  let delta = 0;
  if (align === 'start') delta = topDelta;
  else if (topDelta < 0) delta = topDelta;
  // Taller than the container: show its top rather than its bottom.
  else if (bottomDelta > 0) delta = Math.min(bottomDelta, topDelta);

  if (Math.abs(delta) >= 1) scroller.scrollBy({ top: delta, behavior });
  return true;
}
