'use client';

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { UI_SCENE_BUTTON } from '@/utils/constants';
import { SceneControlButton } from '@/components/ui/SceneControlButton';
import { useIsMac } from '@/hooks/useIsMac';
import { formatShortcutKeys } from '@/utils/platform';

// Matches the Object Explorer button's baseline (bottom 16px).
const BASE_BOTTOM = 16;
// Matches the Object Explorer button's distance from the border.
const EDGE_MARGIN = 10;
const LEFT_SIDEBAR_SELECTOR = '[data-sidebar="left"]';
const STORAGE_KEY = 'compas-scene-controls-hint-open';

interface SceneControlsHintProps {
  isViewerReady: boolean;
  isFirstPersonMode: boolean;
  /** Extra bottom offset (px) so the docked DAW timeline doesn't cover the hint. */
  bottomOffset?: number;
}

interface ControlHint {
  label: string;
  command: string;
}

const VIEWER_HINTS: ControlHint[] = [
  { label: 'Select', command: 'Left-click' },
  { label: 'Pan', command: 'Middle-click' },
  { label: 'Rotate', command: 'Right-click' },
  { label: 'Add to selection', command: 'Shift + click' },
  { label: 'Deselect', command: 'Ctrl + click' },
];

const FPS_HINTS: ControlHint[] = [
  { label: 'Look around', command: 'Left-drag' },
  { label: 'Focal length', command: 'Scroll' },
  { label: 'Roll', command: 'Right-drag' },
  { label: 'Rotate view', command: 'Arrow keys' },
  { label: 'Exit first-person', command: 'Esc' },
];

function readStoredOpen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

/**
 * Control hints anchored at the bottom-left of the 3D viewer.
 *
 * - Orbit mode shows mouse navigation; first-person mode swaps to FPS controls.
 * - Transparent until hovered (then a glass background + close button appear).
 * - Collapses to a scene control button (persisted in localStorage).
 */
export function SceneControlsHint({
  isViewerReady,
  isFirstPersonMode,
  bottomOffset = 0,
}: SceneControlsHintProps) {
  const isMac = useIsMac();
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [leftOffset, setLeftOffset] = useState(EDGE_MARGIN);

  const measureLeftOffset = useCallback(() => {
    const leftEl = document.querySelector<HTMLElement>(LEFT_SIDEBAR_SELECTOR);
    const rect = leftEl?.getBoundingClientRect();
    const next =
      rect && rect.width > 0 ? Math.round(rect.right) + EDGE_MARGIN : EDGE_MARGIN;
    setLeftOffset((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    setIsOpen(readStoredOpen());
  }, []);

  useLayoutEffect(() => {
    if (!isViewerReady) return;
    measureLeftOffset();
  }, [isViewerReady, measureLeftOffset]);

  useEffect(() => {
    if (!isViewerReady) return;

    const ro = new ResizeObserver(() => measureLeftOffset());
    const observeSidebars = () => {
      ro.disconnect();
      document.querySelectorAll(LEFT_SIDEBAR_SELECTOR).forEach((el) => ro.observe(el));
      measureLeftOffset();
    };

    observeSidebars();
    const mo = new MutationObserver(observeSidebars);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measureLeftOffset);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measureLeftOffset);
    };
  }, [isViewerReady, measureLeftOffset]);

  const setOpen = (open: boolean) => {
    setIsOpen(open);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(open));
    } catch {
      /* ignore unavailable storage */
    }
  };

  if (!isViewerReady) return null;

  const hints = isFirstPersonMode ? FPS_HINTS : VIEWER_HINTS;

  return (
    <div
      className="absolute flex flex-col items-center pointer-events-auto z-20 transition-all duration-300"
      style={{
        gap: UI_SCENE_BUTTON.GAP,
        left: `${leftOffset}px`,
        bottom: `${BASE_BOTTOM + bottomOffset}px`,
      }}
    >
      {isOpen ? (
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`relative flex flex-col gap-0.5 px-2 py-1.5 rounded-md border transition-colors ${
            isHovered ? 'bg-background/70 backdrop-blur-sm border-border' : 'bg-transparent border-transparent'
          }`}
        >
          {isHovered && (
            <button
              onClick={() => setOpen(false)}
              aria-label="Hide controls"
              title="Hide controls"
              className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-background border border-border text-[10px] leading-none text-secondary-hover hover:text-foreground transition-colors"
            >
              ×
            </button>
          )}
          {hints.map((hint) => (
            <div
              key={hint.label}
              className="flex items-baseline gap-1.5 text-[9px] leading-tight whitespace-nowrap"
            >
              <span className="font-medium text-foreground">{hint.label}</span>
              <span className="text-secondary-hover">{formatShortcutKeys(hint.command, isMac)}</span>
            </div>
          ))}
        </div>
      ) : (
        <SceneControlButton
          onClick={() => setOpen(true)}
          title="Show controls"
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>
          }
        />
      )}
    </div>
  );
}
