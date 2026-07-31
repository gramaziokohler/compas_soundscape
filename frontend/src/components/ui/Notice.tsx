"use client";

import type { ReactNode } from "react";
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

const BAR_STYLES: Record<NoticeType, string> = {
  error: "bg-error-hover border-error text-white",
  warning: "bg-warning-hover border-warning text-white",
  info: "bg-info-hover border-info text-white",
  success: "bg-success-hover border-success text-white",
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
      className={`px-2 py-1.5 text-xs rounded-lg border flex items-start gap-2 ${BAR_STYLES[type]}`}
    >
      <span className="flex-1">{message}</span>
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
