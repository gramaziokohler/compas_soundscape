'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ShortcutKeys } from '@/components/ui/ShortcutKeys';
import { clampToViewport } from '@/utils/scale';
import { ACTION_MENU } from '@/utils/constants';

export type ActionMenuItem =
  | {
      kind: 'action';
      key: string;
      label: string;
      icon: LucideIcon;
      /** Key combo shown as keycap chips, e.g. "Shift + H". */
      shortcut?: string;
      disabled?: boolean;
      /** Row action. The menu closes automatically after it runs. */
      onSelect: () => void;
    }
  | { kind: 'separator'; key: string };

export interface ActionMenuProps {
  /** Viewport point the menu opens at (top-left corner, clamped into the viewport). */
  x: number;
  y: number;
  items: ActionMenuItem[];
  /** Called on outside pointerdown, Escape, or after an item runs. */
  onClose: () => void;
}

/**
 * ActionMenu Component
 *
 * Body-portaled command menu: icon + label rows with optional shortcut chips and
 * separators. Measures itself on mount and clamps into the viewport; closes on
 * outside pointerdown or Escape (without consuming Escape, so global handlers
 * such as "clear selection" still run).
 *
 * Usage:
 * ```tsx
 * <ActionMenu x={e.clientX} y={e.clientY} items={[
 *   { kind: 'action', key: 'hide', label: 'Hide', icon: EyeOff, shortcut: 'Shift + H', onSelect: hide },
 *   { kind: 'separator', key: 'sep' },
 * ]} onClose={close} />
 * ```
 */
export function ActionMenu({ x, y, items, onClose }: ActionMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Measure, then clamp into the viewport before paint (panel starts invisible).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const width = panel.offsetWidth || ACTION_MENU.MIN_WIDTH;
    const height = panel.offsetHeight || items.length * ACTION_MENU.ESTIMATED_ITEM_HEIGHT;
    setPos(clampToViewport(x, y, width, height, ACTION_MENU.VIEWPORT_MARGIN));
  }, [x, y, items.length]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-hidden={!pos}
      className="action-menu"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        left: pos ? pos.x : x,
        top: pos ? pos.y : y,
        minWidth: ACTION_MENU.MIN_WIDTH,
        zIndex: ACTION_MENU.Z_INDEX,
        opacity: pos ? 1 : 0,
        pointerEvents: pos ? 'auto' : 'none',
      }}
    >
      {items.map((item) => {
        if (item.kind === 'separator') {
          return <div key={item.key} role="separator" className="action-menu__separator" />;
        }
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="action-menu__row"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <Icon
              className="action-menu__icon"
              size={ACTION_MENU.ICON_SIZE}
              strokeWidth={ACTION_MENU.ICON_STROKE}
              aria-hidden="true"
            />
            <span className="action-menu__label">{item.label}</span>
            {item.shortcut && <ShortcutKeys keys={item.shortcut} />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
