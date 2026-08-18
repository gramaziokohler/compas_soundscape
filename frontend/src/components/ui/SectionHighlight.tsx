/**
 * SectionHighlight Component
 *
 * Draws a transient animated border around any DOM element identified by id.
 * A colored line draws clockwise around the element's border until the ring
 * is complete, then the whole ring fades away. Used to draw attention to a
 * section after navigating to it from another part of the app.
 *
 * The stroke color is the photographic negative of the target's visible
 * border, or of its `--card-color` accent when the wrapper itself has no
 * border (Listeners). Hairline `--color-border` chrome is ignored so the
 * ring stays visible. Pass `color` to override.
 *
 * Implementation: measures the target's bounding rect (re-measuring while
 * sidebars/panels animate open and while the page scrolls/resizes) and paints a
 * fixed, pointer-events-none overlay ring via a portal to document.body, so it
 * is never clipped by a transformed/overflow-hidden ancestor.
 *
 * The ring is a conic-gradient applied only to a 2px border using the
 * gradient-border + mask-composite technique. `--section-highlight-progress`
 * grows from 0% to 100% so the stroke completes a full loop. Keyframes live
 * in globals.css.
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
  /** Override the auto-inverted border color. CSS token (`var(--color-*)`) preferred. */
  color?: string;
}

const SPIN_MS = 900;
const FALLBACK_COLOR = 'var(--color-primary)';
/** Ignore hairline/token borders like `--color-border` (alpha ~0.07). */
const MIN_EDGE_ALPHA = 0.4;
const CARD_COLOR_WALK = 4;

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseCssColor(color: string): ParsedColor | null {
  const comma = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (comma) {
    return {
      r: Number(comma[1]),
      g: Number(comma[2]),
      b: Number(comma[3]),
      a: comma[4] === undefined ? 1 : Number(comma[4]),
    };
  }
  const space = color.match(
    /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i,
  );
  if (space) {
    const rawA = space[4];
    const a =
      rawA === undefined ? 1 : rawA.endsWith('%') ? parseFloat(rawA) / 100 : Number(rawA);
    return { r: Number(space[1]), g: Number(space[2]), b: Number(space[3]), a };
  }
  return null;
}

function isUsableColor(color: string): boolean {
  const parsed = parseCssColor(color);
  return !!parsed && parsed.a >= MIN_EDGE_ALPHA;
}

function invertCssColor(color: string): string | null {
  const parsed = parseCssColor(color);
  if (!parsed || parsed.a < MIN_EDGE_ALPHA) return null;
  return `rgb(${255 - Math.round(parsed.r)}, ${255 - Math.round(parsed.g)}, ${255 - Math.round(parsed.b)})`;
}

/** Resolve `var(--token)` / any CSS color to a computed `rgb()` in `context`. */
function resolveCssColorValue(context: HTMLElement, value: string): string | null {
  if (isUsableColor(value)) return value;
  const probe = document.createElement('span');
  probe.style.color = value;
  context.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  context.removeChild(probe);
  return isUsableColor(computed) ? computed : null;
}

function readVisibleBorderColor(el: Element): string | null {
  const style = getComputedStyle(el);
  const width = parseFloat(style.borderTopWidth) || 0;
  if (width > 0 && style.borderTopStyle !== 'none' && isUsableColor(style.borderTopColor)) {
    return style.borderTopColor;
  }
  const outlineW = parseFloat(style.outlineWidth) || 0;
  if (outlineW > 0 && style.outlineStyle !== 'none' && isUsableColor(style.outlineColor)) {
    return style.outlineColor;
  }
  return null;
}

/**
 * `--card-color` is the section accent (e.g. warning on Listeners). It lives on
 * CardSection, which is often a child of the highlight target wrapper.
 */
function readCardAccentColor(el: HTMLElement): string | null {
  let node: HTMLElement | null = el;
  for (let i = 0; i < CARD_COLOR_WALK && node; i++) {
    const raw = getComputedStyle(node).getPropertyValue('--card-color').trim();
    if (raw) {
      const resolved = resolveCssColorValue(node, raw);
      if (resolved) return resolved;
    }
    node = node.firstElementChild instanceof HTMLElement ? node.firstElementChild : null;
  }
  return null;
}

/** Target's own border, else section accent, else background, else text color. */
function resolveTargetEdgeColor(el: HTMLElement): string {
  const own = readVisibleBorderColor(el);
  if (own) return own;

  const accent = readCardAccentColor(el);
  if (accent) return accent;

  const style = getComputedStyle(el);
  if (isUsableColor(style.backgroundColor)) return style.backgroundColor;
  return style.color;
}

function resolveHighlightColor(el: HTMLElement, override?: string): string {
  if (override) return override;
  return invertCssColor(resolveTargetEdgeColor(el)) ?? FALLBACK_COLOR;
}

export function SectionHighlight({
  targetId,
  trigger,
  duration = SPIN_MS + 500,
  color,
}: SectionHighlightProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [radius, setRadius] = useState('8px');
  const [strokeColor, setStrokeColor] = useState(FALLBACK_COLOR);
  const timerRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = document.getElementById(targetId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    setRect(r);
    setRadius(getComputedStyle(el).borderRadius || '8px');
    setStrokeColor(resolveHighlightColor(el, color));
    return true;
  }, [targetId, color]);

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
      key={trigger}
      aria-hidden
      style={{
        position: 'fixed',
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        pointerEvents: 'none',
        zIndex: 100000,
        boxSizing: 'border-box',
        border: '2px solid transparent',
        borderRadius: radius,
        background: `conic-gradient(${strokeColor} var(--section-highlight-progress), transparent 0) border-box`,
        mask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
        WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        animation: `section-highlight-spin ${SPIN_MS}ms linear forwards, section-highlight-fade ${duration - SPIN_MS}ms ease-in ${SPIN_MS}ms forwards`,
      }}
    />,
    document.body,
  );
}
