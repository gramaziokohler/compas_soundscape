'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport } from '@/utils/scale';
import { SIDEBAR_BREADCRUMB_MENU } from '@/utils/constants';

export interface ContextMenuItem {
  /** Stable identity used as the React key. */
  key: string;
  /** Row label. */
  label: string;
  /** Marks the currently selected item — gets the primary fill. */
  isActive?: boolean;
  /** Appends a muted "(pending)" suffix. */
  pending?: boolean;
  /** Row action. The menu closes automatically after it runs. */
  onClick: () => void;
}

export interface ContextMenuProps {
  /** Viewport x (px) where the menu should open, typically `e.clientX`. */
  x: number;
  /** Viewport y (px) where the menu should open, typically `e.clientY`. */
  y: number;
  /** Optional heading shown above the rows. */
  title?: string;
  /** Menu rows. */
  items: ContextMenuItem[];
  /** Shown instead of the rows when `items` is empty. */
  emptyMessage?: string;
  /** Called when the menu should close (outside click, Escape, or item pick). */
  onClose: () => void;
}

/**
 * ContextMenu Component
 *
 * A small body-portaled popup menu opened at an explicit viewport position
 * (right-click coordinates). It measures itself on mount and clamps into the
 * viewport via `clampToViewport`, marks the active row, and closes on outside
 * pointerdown or Escape. Rendered through a portal so it escapes transformed /
 * `overflow: hidden` ancestors (e.g. the frosted sidebar).
 *
 * Usage:
 * ```tsx
 * {menu && (
 *   <ContextMenu
 *     x={menu.x}
 *     y={menu.y}
 *     title="Switch context"
 *     items={items}
 *     emptyMessage="No sections available"
 *     onClose={() => setMenu(null)}
 *   />
 * )}
 * ```
 */
export function ContextMenu({ x, y, title, items, emptyMessage, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Measure the rendered menu, then clamp it into the viewport. Runs before
  // paint while the panel is still invisible (opacity 0) — no flash/jump.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const width = panel.offsetWidth || SIDEBAR_BREADCRUMB_MENU.WIDTH;
    const fallbackHeight =
      (items.length || 1) * SIDEBAR_BREADCRUMB_MENU.ESTIMATED_ITEM_HEIGHT +
      (title ? SIDEBAR_BREADCRUMB_MENU.ESTIMATED_ITEM_HEIGHT : 0);
    const height = panel.offsetHeight || fallbackHeight;
    setPos(
      clampToViewport(x, y, width, height, SIDEBAR_BREADCRUMB_MENU.VIEWPORT_MARGIN),
    );
  }, [x, y, items.length, title]);

  // Close on outside pointerdown and Escape.
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

  const handlePick = useCallback(
    (item: ContextMenuItem) => {
      item.onClick();
      onClose();
    },
    [onClose],
  );

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-hidden={!pos}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: 'fixed',
        left: pos ? pos.x : x,
        top: pos ? pos.y : y,
        width: SIDEBAR_BREADCRUMB_MENU.WIDTH,
        maxHeight: `calc(100vh - ${SIDEBAR_BREADCRUMB_MENU.VIEWPORT_MARGIN * 2}px)`,
        overflowY: 'auto',
        zIndex: SIDEBAR_BREADCRUMB_MENU.Z_INDEX,
        opacity: pos ? 1 : 0,
        pointerEvents: pos ? 'auto' : 'none',
        backgroundColor: 'var(--color-surface-2)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-lg)',
        padding: '4px 0',
        fontSize: '11px',
      }}
    >
      {title && (
        <div
          className="px-3 py-1.5 text-[9px] uppercase tracking-wider"
          style={{ color: 'var(--color-secondary-hover)' }}
        >
          {title}
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-secondary-hover)' }}>
          {emptyMessage ?? 'No items'}
        </div>
      ) : (
        items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitemradio"
            aria-checked={!!item.isActive}
            onClick={() => handlePick(item)}
            className={`card-context-menu-item flex items-center gap-2 w-full text-left py-2 px-3 text-xs transition-colors cursor-pointer ${
              item.isActive ? 'active' : 'text-foreground hover:bg-secondary-light'
            }`}
            style={
              item.isActive
                ? {
                    backgroundColor: 'var(--color-blue-chip-bg)',
                    color: 'var(--color-primary)',
                  }
                : undefined
            }
          >
            <span className="flex-shrink-0 w-3 h-3 flex items-center justify-center">
              {item.isActive ? '✓' : ''}
            </span>
            <span className="flex-1 min-w-0 truncate">{item.label}</span>
            {item.pending && (
              <span className="flex-shrink-0" style={{ color: 'var(--color-secondary-hover)' }}>
                (pending)
              </span>
            )}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
