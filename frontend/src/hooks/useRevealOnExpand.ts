'use client';

import { useEffect, type RefObject } from 'react';
import { CARD_REVEAL } from '@/utils/constants';

function isScrollable(el: Element): boolean {
  const { overflowY } = getComputedStyle(el);
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
}

/**
 * Scroll every scrollable ancestor of `from` so a region ending at `bottom` (viewport px) shows,
 * never moving `anchorTop` (the control the user just used) above the top of a container.
 */
function revealBelow(from: Element, anchorTop: number, bottom: number): void {
  let shift = 0;
  for (let el: Element | null = from.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!isScrollable(el)) continue;
    const rect = el.getBoundingClientRect();
    const hidden = bottom - shift + CARD_REVEAL.MARGIN_PX - rect.bottom;
    if (hidden <= 0) continue;
    const room = anchorTop - shift - CARD_REVEAL.MARGIN_PX - rect.top;
    const delta = Math.min(hidden, Math.max(0, room));
    if (delta <= 0) continue;
    el.scrollBy({ top: delta, behavior: 'smooth' });
    shift += delta;
  }
}

/**
 * When a click / change inside `ref` (a checkbox, toggle, select…) mounts new content below the
 * control and that content falls under the bottom of a scroll container (the card body, the
 * sidebar), scroll it into view. Content that mounts on its own (progress, results) is ignored:
 * only additions right after a user input count.
 *
 * Usage:
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * useRevealOnExpand(ref);
 * return <div ref={ref}>…</div>;
 * ```
 */
export function useRevealOnExpand(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof MutationObserver === 'undefined') return;
    let last: { target: Element; at: number } | null = null;
    let frame = 0;
    let added: Element[] = [];

    const onInput = (e: Event) => {
      if (!(e.target instanceof Element)) return;
      // Expanding / collapsing the card itself is not an option of it.
      last = e.target.closest(`[${CARD_REVEAL.IGNORE_ATTR}]`) ? null : { target: e.target, at: performance.now() };
    };

    const flush = () => {
      frame = 0;
      const nodes = added.filter((n) => n.isConnected);
      added = [];
      const input = last;
      if (!input || !input.target.isConnected || nodes.length === 0) return;
      const anchor = input.target.closest('label, button, select, [role="switch"], [role="checkbox"]') ?? input.target;
      const following = nodes.filter(
        (n) => !n.contains(anchor) && !!(anchor.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
      if (following.length === 0) return;
      const bottom = Math.max(...following.map((n) => n.getBoundingClientRect().bottom));
      revealBelow(following[following.length - 1], anchor.getBoundingClientRect().top, bottom);
    };

    const observer = new MutationObserver((records) => {
      if (!last || performance.now() - last.at > CARD_REVEAL.INPUT_WINDOW_MS) return;
      for (const record of records) {
        record.addedNodes.forEach((n) => { if (n instanceof Element) added.push(n); });
      }
      // Let the new content lay out (and any nested mounts land) before measuring.
      if (added.length > 0 && !frame) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(flush); });
    });

    root.addEventListener('click', onInput, true);
    root.addEventListener('change', onInput, true);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener('click', onInput, true);
      root.removeEventListener('change', onInput, true);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
