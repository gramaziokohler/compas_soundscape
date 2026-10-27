'use client';

/**
 * ModalShell
 *
 * Centered modal dialog portaled to `<body>`: dimmed backdrop, frosted panel
 * with a title row and close button. Escape and a backdrop click call
 * `onClose`. Content is free-form (forms, lists).
 *
 * Usage:
 * ```tsx
 * <ModalShell title="New material" onClose={close} width="28rem">
 *   ...form...
 * </ModalShell>
 * ```
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { MODAL_SHELL, UI_BORDER_RADIUS } from '@/utils/constants';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** CSS width of the panel (capped at 92vw). */
  width?: string;
}

export function ModalShell({ title, onClose, children, width = MODAL_SHELL.DEFAULT_WIDTH }: ModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // An open dropdown inside the dialog consumes Escape (CardSelect closes itself).
      if (document.querySelector('.select-menu.open')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 flex items-center justify-center pointer-events-auto"
      style={{
        zIndex: MODAL_SHELL.Z_INDEX,
        backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="frosted-surface backdrop-blur-lg backdrop-saturate-150 shadow-lg flex flex-col"
        style={{
          width: `min(92vw, ${width})`,
          maxHeight: MODAL_SHELL.MAX_HEIGHT,
          border: '1px solid var(--color-overlay-border)',
          borderRadius: `${UI_BORDER_RADIUS.MD}px`,
          background: 'var(--color-overlay-bg)',
          padding: MODAL_SHELL.PADDING_PX,
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <button
            type="button"
            aria-label="Close"
            className="p-0.5 rounded text-secondary-hover hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
