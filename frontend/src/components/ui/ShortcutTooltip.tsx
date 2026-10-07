'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShortcutKeys } from '@/components/ui/ShortcutKeys';
import { toAriaKeyShortcuts } from '@/utils/platform';
import { KEYBOARD_SHORTCUTS, SHORTCUT_TOOLTIP, type ShortcutDef, type ShortcutId } from '@/utils/constants';

interface ShortcutTooltipProps {
  shortcut: ShortcutId;
  /** Overrides the shortcut's label (e.g. "Unmute" vs "Mute"). */
  label?: string;
  /** Replaces the hint line — e.g. why the action is disabled. */
  note?: string;
  children: ReactNode;
}

interface Position {
  left: number;
  top: number;
}

/**
 * Hover / focus tooltip showing an action name, its key chips and an
 * optional hint line:
 *
 *   Generate            [Ctrl] [Enter]
 *   From any prompt field
 *
 * Wraps its trigger in a `display: contents` span so it never affects layout.
 * Placed above the trigger, flipped below when there is no room.
 */
export function ShortcutTooltip({ shortcut, label, note, children }: ShortcutTooltipProps) {
  const def: ShortcutDef = KEYBOARD_SHORTCUTS[shortcut];
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), SHORTCUT_TOOLTIP.SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => clearTimer, []);

  // Close on scroll / any press so the tooltip never lingers over moved content.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('pointerdown', hide, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('pointerdown', hide, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = wrapperRef.current?.firstElementChild;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;
    const r = trigger.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    const margin = SHORTCUT_TOOLTIP.VIEWPORT_MARGIN;
    const above = r.top - SHORTCUT_TOOLTIP.OFFSET - height;
    const top = above >= margin ? above : r.bottom + SHORTCUT_TOOLTIP.OFFSET;
    const centered = r.left + r.width / 2 - width / 2;
    const left = Math.min(Math.max(centered, margin), window.innerWidth - width - margin);
    setPos({ left, top });
  }, [open]);

  const secondary = note ?? def.hint;

  return (
    <span
      ref={wrapperRef}
      style={{ display: 'contents' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      // Keyboard focus only — a mouse click also focuses the button, and the
      // tooltip must not reappear right after the press that dismissed it.
      onFocus={(e) => { if (e.target.matches(':focus-visible')) show(); }}
      onBlur={hide}
    >
      {children}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className="shortcut-tooltip"
          style={{
            maxWidth: SHORTCUT_TOOLTIP.MAX_WIDTH,
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div className="shortcut-tooltip__row">
            <span className="shortcut-tooltip__label">{label ?? def.label}</span>
            <ShortcutKeys keys={def.keys} altKeys={def.altKeys} />
          </div>
          {secondary && <div className="shortcut-tooltip__hint">{secondary}</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}

interface OptionalShortcutTooltipProps extends Omit<ShortcutTooltipProps, 'shortcut'> {
  shortcut?: ShortcutId;
}

/** ShortcutTooltip when `shortcut` is set, otherwise renders children unchanged. */
export function OptionalShortcutTooltip({ shortcut, children, ...rest }: OptionalShortcutTooltipProps) {
  return shortcut ? <ShortcutTooltip shortcut={shortcut} {...rest}>{children}</ShortcutTooltip> : <>{children}</>;
}

/** aria-keyshortcuts value for a shortcut id (undefined when none). */
export function ariaKeyShortcuts(shortcut: ShortcutId | undefined): string | undefined {
  return shortcut ? toAriaKeyShortcuts(KEYBOARD_SHORTCUTS[shortcut].keys) : undefined;
}
