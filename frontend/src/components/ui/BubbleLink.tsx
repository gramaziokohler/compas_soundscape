"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SIMPLE_MODE } from "@/utils/constants";
import type { BubbleTone } from "@/components/ui/Bubble";

/** DOM id of a bubble that a panel can link back to (pass it as the bubble's `id`). */
export function bubbleAnchorId(column: string, key: string | number): string {
  return `${SIMPLE_MODE.LINK_ANCHOR_PREFIX}${column}-${key}`;
}

/** DOM id of the panel a bubble expanded into (pass it as the panel's `id`). */
export function bubblePanelId(column: string): string {
  return `${SIMPLE_MODE.LINK_PANEL_PREFIX}${column}`;
}

interface LinkGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function sameGeometry(a: LinkGeometry | null, b: LinkGeometry | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

/** Bubble side-center → nearest panel edge, level with the bubble when the panel spans it. */
function measure(anchorId: string, panelId: string): LinkGeometry | null {
  const anchor = document.getElementById(anchorId)?.getBoundingClientRect();
  const panel = document.getElementById(panelId)?.getBoundingClientRect();
  if (!anchor || !panel || anchor.width === 0 || panel.width === 0) return null;
  const y1 = anchor.top + anchor.height / 2;
  const panelOnRight = anchor.left + anchor.width / 2 < panel.left;
  const x1 = panelOnRight ? anchor.right : anchor.left;
  const x2 = panelOnRight ? panel.left : panel.right;
  const inset = Math.min(SIMPLE_MODE.LINK_EDGE_INSET, panel.height / 2);
  const y2 = Math.min(Math.max(y1, panel.top + inset), panel.bottom - inset);
  return { x1, y1, x2, y2 };
}

export interface BubbleLinkProps {
  /** DOM id of the source bubble (see `bubbleAnchorId`). */
  anchorId: string;
  /** DOM id of the expanded panel (see `bubblePanelId`). */
  panelId: string;
  tone?: BubbleTone;
}

/**
 * BubbleLink Component
 *
 * Thin connector from an expanded bubble to its panel, so it is clear which
 * bubble a panel belongs to. Tracks both elements every frame (bubble columns
 * scroll and reorder, panels resize) and hides while either is missing — e.g.
 * the bubble is scrolled out of its column window. Straight when the panel
 * spans the bubble's height, an S-curve to the panel's nearest corner otherwise.
 * Portaled to `body` and click-through.
 *
 * Usage:
 * ```tsx
 * <Bubble id={bubbleAnchorId('scene', i)} … />
 * <BubblePanel id={bubblePanelId('scene')} … />
 * <BubbleLink anchorId={bubbleAnchorId('scene', i)} panelId={bubblePanelId('scene')} />
 * ```
 */
export function BubbleLink({ anchorId, panelId, tone = "primary" }: BubbleLinkProps) {
  const [geometry, setGeometry] = useState<LinkGeometry | null>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = measure(anchorId, panelId);
      setGeometry((prev) => (sameGeometry(prev, next) ? prev : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [anchorId, panelId]);

  if (!geometry) return null;
  const { x1, y1, x2, y2 } = geometry;
  const midX = (x1 + x2) / 2;
  const d = y1 === y2
    ? `M ${x1} ${y1} L ${x2} ${y2}`
    : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

  return createPortal(
    <svg
      className={`bubble-link${tone !== "primary" ? ` bubble-link--${tone}` : ""}`}
      style={{ zIndex: SIMPLE_MODE.Z_INDEX }}
      aria-hidden="true"
    >
      <path d={d} fill="none" strokeWidth={SIMPLE_MODE.LINK_STROKE} strokeLinecap="round" />
      <circle cx={x1} cy={y1} r={SIMPLE_MODE.LINK_DOT_RADIUS} />
      <circle cx={x2} cy={y2} r={SIMPLE_MODE.LINK_DOT_RADIUS} />
    </svg>,
    document.body,
  );
}
