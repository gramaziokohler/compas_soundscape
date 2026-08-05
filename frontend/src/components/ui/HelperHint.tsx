"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { UI_HELPER_HINT, UI_SCENE_BUTTON, UI_RIGHT_SIDEBAR } from "@/utils/constants";
import { useRightSidebarStore } from "@/store";

interface HelperHintProps {
  /** The helper text to display. Pass null (or unmount) to hide the hint. */
  text: string | null;
  /** How long the hint stays visible before fading away. Defaults to UI_HELPER_HINT.DURATION_MS. */
  durationMs?: number;
}

/**
 * HelperHint Component
 *
 * Small transient hint that appears at the bottom-right of the 3D viewer, just left
 * of the scene control buttons (Object Explorer / timeline / volume, ...), and moves
 * with them when the right sidebar expands or collapses. It is always on top (above
 * the timeline panel) and its letters are rendered as the negative of whatever is
 * behind them (mix-blend-mode: difference), so it stays readable over the dynamic
 * 3D canvas. It fades away automatically after `durationMs`.
 *
 * Rendered through a portal to `document.body` so `mix-blend-mode` escapes the
 * sidebar's stacking context (opacity < 1) and inverts the actual canvas backdrop.
 *
 * Usage:
 * ```tsx
 * <HelperHint text="Hold shift to select multiple objects, press Enter when finished." />
 * <HelperHint text={phase === 'selecting' ? 'Selecting surfaces…' : null} />
 * ```
 */
export function HelperHint({ text, durationMs = UI_HELPER_HINT.DURATION_MS }: HelperHintProps) {
  const isRightSidebarExpanded = useRightSidebarStore((s) => s.isExpanded);
  const rightSidebarWidth = useRightSidebarStore((s) => s.width);

  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!text) return;
    // Fade in, then fade away after the duration.
    setIsVisible(true);
    const fadeIn = requestAnimationFrame(() => setIsVisible(true));
    const hideTimer = setTimeout(() => setIsVisible(false), durationMs);
    return () => {
      cancelAnimationFrame(fadeIn);
      clearTimeout(hideTimer);
      setIsVisible(false);
    };
  }, [text, durationMs]);

  if (!text) return null;

  const sidebarOffset = isRightSidebarExpanded ? (rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) : 0;
  const buttonsRight = sidebarOffset + UI_HELPER_HINT.BUTTON_COLUMN_MARGIN;
  const buttonColumnWidth = parseInt(UI_SCENE_BUTTON.SIZE, 10);
  const hintRight =
    buttonsRight + buttonColumnWidth + UI_HELPER_HINT.GAP_BETWEEN_BUTTONS;

  const hint = (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        right: `${hintRight}px`,
        bottom: `${UI_HELPER_HINT.BOTTOM}px`,
        zIndex: UI_HELPER_HINT.Z_INDEX,
        pointerEvents: 'none',
        maxWidth: '280px',
        textAlign: 'right',
        // Letters are the negative of the backdrop behind them (readable over the 3D canvas).
        color: '#ffffff',
        mixBlendMode: 'difference',
        fontSize: '11px',
        lineHeight: '1.4',
        fontWeight: 500,
        opacity: isVisible ? 1 : 0,
        transition: `opacity ${UI_HELPER_HINT.FADE_MS}ms ease-in-out`,
      }}
    >
      {text}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(hint, document.body) : null;
}
