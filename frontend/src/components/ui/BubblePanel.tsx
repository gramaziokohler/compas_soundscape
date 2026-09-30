"use client";

import type { CSSProperties, ReactNode } from "react";
import { SIMPLE_MODE } from "@/utils/constants";

export interface BubblePanelProps {
  /** Header title; omit for a header-less panel (the content brings its own). */
  title?: ReactNode;
  /** Muted line under the title. */
  subtitle?: ReactNode;
  /** Extra header buttons, rendered before reduce / remove. */
  actions?: ReactNode;
  /** "−" button — collapse the panel back into its bubble. */
  onReduce?: () => void;
  /** "×" button — remove the underlying item. */
  onRemove?: () => void;
  removeTitle?: string;
  /** Disable the remove button (e.g. while a workflow runs). */
  removeDisabledReason?: string;
  /** Panel positioning (fixed/absolute coordinates) supplied by the owning column. */
  style?: CSSProperties;
  width?: number | string;
  ariaLabel: string;
  children: ReactNode;
}

/**
 * BubblePanel Component
 *
 * Floating frosted panel that a Simple-mode bubble expands into. Compact header
 * (title, optional actions, reduce, remove) over a scrollable, clamped-fluid body.
 *
 * Usage:
 * ```tsx
 * <BubblePanel
 *   ariaLabel="Office lunch sounds"
 *   title="Office lunch"
 *   onReduce={() => setOpen(null)}
 *   onRemove={() => setConfirm(true)}
 *   style={{ position: 'fixed', left: 64, top: 40 }}
 * >
 *   <SoundGenerationSection {...props} />
 * </BubblePanel>
 * ```
 */
export function BubblePanel({
  title,
  subtitle,
  actions,
  onReduce,
  onRemove,
  removeTitle = "Remove",
  removeDisabledReason,
  style,
  width = SIMPLE_MODE.PANEL_WIDTH,
  ariaLabel,
  children,
}: BubblePanelProps) {
  const hasHeader = title !== undefined || actions || onReduce || onRemove;
  return (
    <section
      className="bubble-panel backdrop-blur-lg backdrop-saturate-150"
      style={{ width, maxHeight: SIMPLE_MODE.PANEL_MAX_HEIGHT, zIndex: SIMPLE_MODE.Z_INDEX, ...style }}
      aria-label={ariaLabel}
    >
      {hasHeader && (
        <header className="bubble-panel__header">
          <div className="min-w-0 flex-1">
            {title !== undefined && <div className="bubble-panel__title truncate">{title}</div>}
            {subtitle && <div className="bubble-panel__subtitle truncate">{subtitle}</div>}
          </div>
          {actions}
          {onReduce && (
            <button type="button" className="bubble-panel__icon-btn" onClick={onReduce} title="Reduce" aria-label="Reduce">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="bubble-panel__icon-btn"
              onClick={onRemove}
              disabled={!!removeDisabledReason}
              title={removeDisabledReason ?? removeTitle}
              aria-label={removeTitle}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </button>
          )}
        </header>
      )}
      <div className="bubble-panel__body">{children}</div>
    </section>
  );
}
