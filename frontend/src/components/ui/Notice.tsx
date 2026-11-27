"use client";

import type { CSSProperties, ReactNode } from "react";
import { CardButton, CloseIcon } from "./Card";

export type NoticeType = "error" | "warning" | "info" | "success";

interface NoticeProps {
  type: NoticeType;
  message: ReactNode;
  /** When provided, renders a dismiss button that calls this callback. */
  onDismiss?: () => void;
  /**
   * `bar` = full-width inline message bar (e.g. card error bars).
   * `tag` = compact inline status pill (e.g. "Low energy", "(hidden)").
   */
  variant?: "bar" | "tag";
}

/** Severity accent fed to `.notice-bar` (globals.css) via `--notice-color`. */
const BAR_COLORS: Record<NoticeType, string> = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  success: "var(--color-success)",
};

const TAG_STYLES: Record<NoticeType, string> = {
  error: "bg-error-light border-error text-error",
  warning: "bg-warning-light border-warning text-warning",
  info: "bg-info-light border-info text-info",
  success: "bg-success-light border-success text-success",
};

/**
 * Notice Component
 *
 * Severity-aware message rendering, extracted from the Card error bar.
 * Use `variant="bar"` for inline message bars, `variant="tag"` for status labels.
 *
 * Usage:
 * ```tsx
 * <Notice type="error" message="Simulation failed" onDismiss={clearError} />
 * <Notice type="warning" variant="tag" message="(hidden)" />
 * ```
 */
export function Notice({ type, message, onDismiss, variant = "bar" }: NoticeProps) {
  if (variant === "tag") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 whitespace-nowrap border ${TAG_STYLES[type]}`}
      >
        {message}
      </span>
    );
  }

  return (
    <div
      role="alert"
      className="notice-bar"
      style={{ "--notice-color": BAR_COLORS[type] } as CSSProperties}
    >
      <span className="notice-bar__message">{message}</span>
      {onDismiss && (
        <CardButton
          icon={<CloseIcon />}
          title="Dismiss message"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          variant="close"
        />
      )}
    </div>
  );
}
