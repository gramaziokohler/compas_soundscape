"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Power } from "lucide-react";
import { DeleteConfirmButton } from "@/components/ui/DeleteConfirmButton";
import { SIMPLE_MODE } from "@/utils/constants";

export interface BubblePanelProps {
  /** Header title; omit for a header-less panel (the content brings its own). */
  title?: ReactNode;
  /** Full title shown as a native tooltip when the header title is trimmed or overflows. */
  titleTooltip?: string;
  /** Muted line under the title. */
  subtitle?: ReactNode;
  /** Extra header buttons, rendered before reduce / remove. */
  actions?: ReactNode;
  /** "−" button — collapse the panel back into its bubble. */
  onReduce?: () => void;
  /** Bottom-right trash button — remove the underlying item (after confirmation). */
  onRemove?: () => void;
  removeTitle?: string;
  /** Confirmation question shown above the trash button. */
  removeConfirmMessage?: string;
  /** Power button left of the title (same control as the bubble's flyout). */
  onTogglePower?: () => void;
  powered?: boolean;
  powerTitle?: string;
  /** Disable the remove button (e.g. while a workflow runs). */
  removeDisabledReason?: string;
  /** Extra footer buttons, rendered right of the trash button. */
  footerActions?: ReactNode;
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
 * (power, title, optional actions, reduce) over a scrollable, clamped-fluid
 * body, and a bottom-right trash button that confirms before removing
 * (optional `footerActions` sit right of it).
 *
 * Usage:
 * ```tsx
 * <BubblePanel
 *   ariaLabel="Office lunch sounds"
 *   title="Office lunch"
 *   onReduce={() => setOpen(null)}
 *   onRemove={() => removeScene(index)}
 *   removeConfirmMessage="Remove this scene and its sounds?"
 *   style={{ position: 'fixed', left: 64, top: 40 }}
 * >
 *   <SoundGenerationSection {...props} />
 * </BubblePanel>
 * ```
 */
export function BubblePanel({
  title,
  titleTooltip,
  subtitle,
  actions,
  onReduce,
  onRemove,
  removeTitle = "Remove",
  removeConfirmMessage,
  removeDisabledReason,
  footerActions,
  onTogglePower,
  powered = false,
  powerTitle,
  style,
  width = SIMPLE_MODE.PANEL_WIDTH,
  ariaLabel,
  children,
}: BubblePanelProps) {
  const hasHeader = title !== undefined || actions || onReduce || onTogglePower;
  // Tooltip only when something is hidden: a shortened title or a CSS ellipsis.
  const showFullTitle = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const text = titleTooltip ?? el.textContent ?? "";
    const trimmed = titleTooltip !== undefined && typeof title === "string" && titleTooltip !== title;
    el.title = trimmed || el.scrollWidth > el.clientWidth ? text : "";
  };
  return (
    <section
      className="bubble-panel backdrop-blur-lg backdrop-saturate-150"
      style={{ width, maxHeight: SIMPLE_MODE.PANEL_MAX_HEIGHT, zIndex: SIMPLE_MODE.Z_INDEX, ...style }}
      aria-label={ariaLabel}
    >
      {hasHeader && (
        <header className="bubble-panel__header">
          {onTogglePower && (
            <button
              type="button"
              className={`bubble-panel__icon-btn${powered ? " power-btn--on" : ""}`}
              onClick={onTogglePower}
              title={powerTitle}
              aria-label={powerTitle ?? "Power"}
              aria-pressed={powered}
            >
              <Power size={SIMPLE_MODE.POWER_ICON_SIZE - 1} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {title !== undefined && <div className="bubble-panel__title truncate" onMouseEnter={showFullTitle}>{title}</div>}
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
        </header>
      )}
      <div className="bubble-panel__body">{children}</div>
      {(onRemove || footerActions) && (
        <footer className="bubble-panel__footer">
          {onRemove && (
            <DeleteConfirmButton
              title={removeTitle}
              message={removeConfirmMessage ?? `${removeTitle}?`}
              onConfirm={onRemove}
              disabledReason={removeDisabledReason}
            />
          )}
          {footerActions}
        </footer>
      )}
    </section>
  );
}
