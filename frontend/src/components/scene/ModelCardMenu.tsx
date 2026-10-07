'use client';

import React, { useEffect, useRef } from 'react';

/**
 * ModelCardMenu
 *
 * Kebab (vertical three-dot) trigger + dropdown shared by the Load-model list
 * cards (Speckle models and No-model projects). The trigger is absolutely
 * positioned in the card's top-right corner; the parent must be `relative`.
 *
 * Usage:
 * ```tsx
 * <div style={{ position: 'relative' }}>
 *   ...card...
 *   <ModelCardMenuTrigger open={open} onToggle={() => setOpen((o) => !o)} />
 *   {open && (
 *     <ModelCardMenu onClose={() => setOpen(false)}>
 *       <ModelCardMenuItem icon={<TrashIcon />} label="Delete" danger onClick={...} />
 *     </ModelCardMenu>
 *   )}
 * </div>
 * ```
 */

const MENU_ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  fontSize: 12,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
};

interface ModelCardMenuTriggerProps {
  open: boolean;
  onToggle: () => void;
}

/** Vertical-ellipsis button that toggles the card menu. */
export function ModelCardMenuTrigger({ open, onToggle }: ModelCardMenuTriggerProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title="More options"
      aria-haspopup="menu"
      aria-expanded={open}
      className="hover:bg-secondary-lighter"
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        border: 'none',
        background: open ? 'var(--color-secondary-lighter)' : undefined,
        color: 'var(--color-secondary-hover)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    </button>
  );
}

interface ModelCardMenuProps {
  onClose: () => void;
  children: React.ReactNode;
}

/** Dropdown panel; closes on outside click. */
export function ModelCardMenu({ onClose, children }: ModelCardMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'absolute',
        top: 28,
        right: 4,
        zIndex: 50,
        minWidth: 160,
        background: 'var(--background)',
        border: '1px solid var(--color-secondary-light)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

interface ModelCardMenuItemProps {
  icon: React.ReactNode;
  label: string;
  /** Renders as an external link when set. */
  href?: string;
  onClick?: () => void;
  /** Red destructive styling. */
  danger?: boolean;
}

/** Single menu row — a link when `href` is given, otherwise a button. */
export function ModelCardMenuItem({ icon, label, href, onClick, danger = false }: ModelCardMenuItemProps) {
  const className = danger
    ? 'hover:bg-error-light'
    : 'hover:bg-secondary-lighter';
  const style: React.CSSProperties = {
    ...MENU_ITEM_STYLE,
    color: danger ? 'var(--color-error)' : 'var(--foreground)',
  };

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={onClick} className={className} style={style}>
        {icon}
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={className}
      style={style}
    >
      {icon}
      {label}
    </button>
  );
}

const MENU_ICON_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 13,
  height: 13,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  style: { flexShrink: 0 },
  'aria-hidden': true,
};

export function ExternalLinkIcon() {
  return (
    <svg {...MENU_ICON_PROPS}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...MENU_ICON_PROPS}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
