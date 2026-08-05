/**
 * SectionHighlight Component
 *
 * Draws a transient animated border around any DOM element identified by id.
 * A primary-colored line sweeps counter-clockwise around the element's border,
 * then the whole ring fades away. Used to draw attention to a section after
 * navigating to it from another part of the app.
 *
 * Implementation: measures the target's bounding rect (re-measuring while
 * sidebars/panels animate open and while the page scrolls/resizes) and paints a
 * fixed, pointer-events-none overlay ring via a portal to document.body, so it
 * is never clipped by a transformed/overflow-hidden ancestor.
 *
 * The ring is a rotating conic-gradient applied only to a 2px border ring using
 * the gradient-border + mask-composite technique. The animation keyframes and
 * the `@property --section-highlight-angle` registration live in globals.css.
 *
 * Usage:
 * ```tsx
 * const [trigger, setTrigger] = useState(0);
 * <SectionHighlight targetId="object-explorer-panel" trigger={trigger} />
 * // later, to re-run: onChange={() => setTrigger((t) => t + 1)}
 * ```
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SectionHighlightProps {
  /** DOM id of the section to highlight. */
  targetId: string;
  /** Increment to (re)run the highlight animation. */
  trigger: number;
  /** Total highlight duration in ms (spin + fade) before it disappears. */
  duration?: number;
  /** Any CSS color value used for the rotating line (var(--color-*) preferred). */
  color?: string;
}

const SPIN_MS = 900;

export function SectionHighlight({
  targetId,
  trigger,
  duration = SPIN_MS + 500,
  color = 'var(--color-primary)',
}: SectionHighlightProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [radius, setRadius] = useState('8px');
  const timerRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = document.getElementById(targetId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    setRect(r);
    setRadius(getComputedStyle(el).borderRadius || '8px');
    return true;
  }, [targetId]);

  useEffect(() => {
    if (trigger <= 0) return;

    // Stop any previous run cleanly.
    setRect(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);

    // The target may only become visible after the sidebar / panel expands and
    // re-renders — retry across a few frames before giving up.
    let attempts = 0;
    const tryMeasure = () => {
      if (measure()) return;
      attempts += 1;
      if (attempts < 12) requestAnimationFrame(tryMeasure);
    };
    tryMeasure();

    // Keep the ring aligned while the sidebar/panel animates open or the page
    // scrolls/resizes during the (short) animation window.
    const reMeasure = () => measure();
    window.addEventListener('scroll', reMeasure, true);
    window.addEventListener('resize', reMeasure);

    const el = document.getElementById(targetId);
    const ro = new ResizeObserver(reMeasure);
    if (el) ro.observe(el);

    timerRef.current = window.setTimeout(() => {
      setRect(null);
      window.removeEventListener('scroll', reMeasure, true);
      window.removeEventListener('resize', reMeasure);
      ro.disconnect();
    }, duration);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener('scroll', reMeasure, true);
      window.removeEventListener('resize', reMeasure);
      ro.disconnect();
    };
  }, [trigger, targetId, duration, measure]);

  if (!rect) return null;

  return createPortal(
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        pointerEvents: 'none',
        zIndex: 100000,
        border: '2px solid transparent',
        borderRadius: radius,
        background: `conic-gradient(from var(--section-highlight-angle), transparent 0deg, ${color} 40deg, transparent 100deg) border-box`,
        WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        animation: `section-highlight-spin ${SPIN_MS}ms linear 1, section-highlight-fade ${duration - SPIN_MS}ms ease-in ${SPIN_MS}ms forwards`,
      }}
    />,
    document.body,
  );
}