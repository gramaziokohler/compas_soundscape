'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport } from '@/utils/scale';
import { CARD_INFO_POPOVER } from '@/utils/constants';

export interface InfoPopoverProps {
  /** Popover title (e.g. the card display name). */
  title?: string;
  /** Main explanatory text shown inside the popover. */
  text: string;
  /** Applied to the trigger wrapper so callers can position it (e.g. `absolute bottom-1.5 right-1.5`). */
  className?: string;
  /** aria-label / tooltip for the trigger button (defaults to 'Info'). */
  label?: string;
  /** Smaller trigger — for inline placement (e.g. at the end of a version line). */
  compact?: boolean;
}

/**
 * InfoPopover Component
 *
 * A circular "i" trigger button that opens a small explanation panel on click.
 * The panel is anchored to the trigger's top-right corner, opens upward (or
 * below the trigger when there is no room above), and is kept fully inside the
 * viewport via `clampToViewport`. Closes on outside pointerdown, Escape, or
 * scroll/resize.
 *
 * Rendered through a portal to `document.body` so it escapes the parent's
 * stacking context — e.g. cards that apply `filter: brightness(...)` create a
 * new stacking context that would trap lower z-indexes.
 *
 * Usage:
 * ```tsx
 * <InfoPopover title="Text-to-Audio" text="Generate an original clip from a text prompt." />
 * <InfoPopover text={description} compact />
 * ```
 */
export function InfoPopover({ title, text, className, label = 'Info', compact = false }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => {
      if (prev) {
        setPos(null);
        return false;
      }
      return true;
    });
  }, []);

  // Measure the rendered panel and place it above the trigger, right-aligned.
  // Runs before paint while the panel is still invisible (opacity 0), so there
  // is no jump/flash. Falls back to opening below the trigger when there is
  // not enough vertical room above it.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth || CARD_INFO_POPOVER.PANEL_WIDTH;
    const height = panel.offsetHeight || 0;

    let x = rect.right - width;
    let y = rect.top - height - CARD_INFO_POPOVER.GAP;
    if (y < CARD_INFO_POPOVER.VIEWPORT_MARGIN) {
      y = rect.bottom + CARD_INFO_POPOVER.GAP;
    }

    const clamped = clampToViewport(x, y, width, height, CARD_INFO_POPOVER.VIEWPORT_MARGIN);
    setPos(clamped);
  }, [open]);

  // Close on outside pointerdown, Escape, scroll, or resize.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onViewportChange = () => close();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open, close]);

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-hidden={!pos}
          style={{
            position: 'fixed',
            left: pos ? pos.x : 0,
            top: pos ? pos.y : 0,
            width: CARD_INFO_POPOVER.PANEL_WIDTH,
            maxHeight: `calc(100vh - ${CARD_INFO_POPOVER.VIEWPORT_MARGIN * 2}px)`,
            overflowY: 'auto',
            zIndex: CARD_INFO_POPOVER.Z_INDEX,
            opacity: pos ? 1 : 0,
            pointerEvents: pos ? 'auto' : 'none',
            backgroundColor: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-lg)',
            padding: '10px 12px',
            fontSize: '11px',
            lineHeight: '1.5',
            color: 'var(--foreground)',
          }}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            {title ? (
              <div
                className="text-xs font-semibold"
                style={{ color: 'var(--color-primary)' }}
              >
                {title}
              </div>
            ) : (
              <span />
            )}
            <button
              onClick={close}
              aria-label="Close"
              title="Close"
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-secondary-hover hover:text-error hover:bg-error-light transition-colors cursor-pointer leading-none"
              style={{ fontSize: '12px' }}
            >
              ×
            </button>
          </div>
          <div style={{ color: 'var(--color-secondary-hover)' }}>{text}</div>
        </div>,
        document.body
      )
    : null;

  return (
    <span ref={wrapperRef} className={className}>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center justify-center rounded-full transition-colors cursor-pointer text-secondary-hover hover:text-foreground hover:bg-secondary-light"
        style={{
          width: compact ? '16px' : CARD_INFO_POPOVER.TRIGGER_SIZE,
          height: compact ? '16px' : CARD_INFO_POPOVER.TRIGGER_SIZE,
          border: compact ? 'none' : '1px solid var(--color-secondary-light)',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            width: compact ? '9px' : CARD_INFO_POPOVER.ICON_SIZE,
            height: compact ? '9px' : CARD_INFO_POPOVER.ICON_SIZE,
          }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>
      {panel}
    </span>
  );
}
