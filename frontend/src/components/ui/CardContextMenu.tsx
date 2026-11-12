'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CustomMenuItem } from '@/types/card';
import { useViewportClampedPosition } from '@/hooks/useViewportClampedPosition';
import { getViewport } from '@/utils/scale';
import { POPUP_MENU } from '@/utils/constants';

export interface CardContextMenuProps {
  /** Viewport point the menu opens at (clamped into the viewport). */
  x: number;
  y: number;
  /** Rows; a row with `subItems` opens them in a flyout submenu. */
  items: CustomMenuItem[];
  /** Adds a leading "Rename" row. */
  onRename?: () => void;
  /** Solid-blue (generated card) styling. */
  onBlueBackground?: boolean;
  onClose: () => void;
}

const MENU_ATTR = 'data-card-context-menu';

type SubItem = NonNullable<CustomMenuItem['subItems']>[number];

function PenIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  );
}

function panelStyle(onBlue: boolean): CSSProperties {
  return {
    position: 'fixed',
    maxHeight: `calc(100vh - ${POPUP_MENU.VIEWPORT_MARGIN * 2}px)`,
    overflowY: 'auto',
    zIndex: POPUP_MENU.Z_INDEX,
    backgroundColor: onBlue ? undefined : 'var(--color-surface-2)',
    border: onBlue ? '1px solid var(--color-on-blue-faint)' : '1px solid var(--color-border-strong)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-lg)',
    minWidth: POPUP_MENU.MIN_WIDTH,
    padding: `${POPUP_MENU.PADDING_Y}px 0`,
    fontSize: '11px',
  };
}

function rowClass(onBlue: boolean, state: 'default' | 'disabled' | 'active' | 'open'): string {
  return [
    'card-context-menu-item flex items-center gap-2 w-full text-left py-2 px-3 text-xs transition-colors',
    state === 'disabled'
      ? `opacity-40 cursor-not-allowed${onBlue ? '' : ' text-secondary-hover'}`
      : state === 'active'
        ? 'active cursor-pointer'
        : onBlue
          ? 'cursor-pointer'
          : `text-foreground cursor-pointer hover:bg-secondary-light${state === 'open' ? ' bg-secondary-light' : ''}`,
  ].join(' ');
}

function activeStyle(onBlue: boolean): CSSProperties {
  return {
    backgroundColor: onBlue ? 'var(--color-blue-chip-bg)' : 'var(--card-color-lighter, var(--color-primary-light))',
    color: onBlue ? 'var(--color-on-blue)' : 'var(--card-color, var(--color-primary))',
  };
}

/** Flyout beside its row: to the right, or to the left when it would leave the viewport. */
function Submenu({ anchor, items, onBlue, onClose }: {
  anchor: DOMRect;
  items: SubItem[];
  onBlue: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: vw, height: vh } = getViewport();
    const margin = POPUP_MENU.VIEWPORT_MARGIN;
    const right = anchor.right + POPUP_MENU.SUBMENU_GAP;
    const x = right + el.offsetWidth <= vw - margin
      ? right
      : Math.max(margin, anchor.left - POPUP_MENU.SUBMENU_GAP - el.offsetWidth);
    const y = Math.max(margin, Math.min(anchor.top - POPUP_MENU.PADDING_Y, vh - margin - el.offsetHeight));
    setPos({ x, y });
  }, [anchor, items.length]);

  return (
    <div
      ref={ref}
      role="menu"
      {...{ [MENU_ATTR]: '' }}
      className={onBlue ? 'card-context-menu--generated' : undefined}
      style={{ ...panelStyle(onBlue), left: pos?.x ?? anchor.right, top: pos?.y ?? anchor.top, opacity: pos ? 1 : 0 }}
    >
      {items.map((sub) => (
        <button
          key={sub.key}
          type="button"
          role="menuitem"
          disabled={sub.disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (sub.disabled) return;
            sub.onClick(e);
            onClose();
          }}
          className={rowClass(onBlue, sub.disabled ? 'disabled' : sub.isActive ? 'active' : 'default')}
          style={sub.isActive ? activeStyle(onBlue) : undefined}
        >
          <span className="flex-1">{sub.label}</span>
          {sub.isActive && <span className="text-[10px] opacity-60">✓</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * CardContextMenu Component
 *
 * The right-click menu of a card, shared by expanded cards and their bubbles so
 * both show the same rows: optional "Rename", then the card's `customButtons`.
 * A row with `subItems` opens them in a flyout submenu (hover or click).
 * Portaled to `document.body`, clamped into the viewport, closes on outside
 * pointerdown, Escape or a pick.
 *
 * Usage:
 * ```tsx
 * {menu && (
 *   <CardContextMenu
 *     x={menu.x}
 *     y={menu.y}
 *     items={customButtons}
 *     onRename={() => startRename()}
 *     onClose={() => setMenu(null)}
 *   />
 * )}
 * ```
 */
export function CardContextMenu({ x, y, items, onRename, onBlueBackground = false, onClose }: CardContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useViewportClampedPosition(ref, x, y);
  const [openSub, setOpenSub] = useState<{ key: string; anchor: DOMRect } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(`[${MENU_ATTR}]`)) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const sub = openSub ? items.find((i) => i.key === openSub.key) : undefined;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const row = (key: string, icon: ReactNode, label: string, item?: CustomMenuItem): ReactNode => {
    const hasSub = !!item?.subItems?.length;
    const disabled = !!item?.disabled && !hasSub;
    const isOpen = hasSub && openSub?.key === key;
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        aria-haspopup={hasSub ? 'menu' : undefined}
        aria-expanded={hasSub ? isOpen : undefined}
        disabled={disabled}
        onMouseEnter={(e) => setOpenSub(hasSub ? { key, anchor: e.currentTarget.getBoundingClientRect() } : null)}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          if (hasSub) {
            setOpenSub({ key, anchor: e.currentTarget.getBoundingClientRect() });
            return;
          }
          if (item) item.onClick?.(e);
          else onRename?.();
          onClose();
        }}
        className={rowClass(onBlueBackground, disabled ? 'disabled' : item?.isActive ? 'active' : isOpen ? 'open' : 'default')}
        style={item?.isActive ? activeStyle(onBlueBackground) : undefined}
      >
        <span className="flex-shrink-0 w-3 h-3 flex items-center justify-center">{icon}</span>
        <span className="flex-1">{label}</span>
        {hasSub && (
          <span className={`text-[10px] ${onBlueBackground ? 'card-context-menu-chevron' : 'text-secondary-hover'}`}>▸</span>
        )}
      </button>
    );
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onPointerDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div
        ref={ref}
        role="menu"
        {...{ [MENU_ATTR]: '' }}
        className={onBlueBackground ? 'card-context-menu--generated' : undefined}
        style={{ ...panelStyle(onBlueBackground), left: pos?.x ?? x, top: pos?.y ?? y, opacity: pos ? 1 : 0 }}
      >
        {onRename && row('rename', <PenIcon />, 'Rename')}
        {items.map((item) => row(item.key, item.icon, item.label, item))}
      </div>
      {sub?.subItems && openSub && (
        <Submenu anchor={openSub.anchor} items={sub.subItems} onBlue={onBlueBackground} onClose={onClose} />
      )}
    </div>,
    document.body,
  );
}
