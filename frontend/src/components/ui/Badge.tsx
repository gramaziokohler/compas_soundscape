"use client";

import type { ReactNode } from "react";

/**
 * Badge Component
 *
 * Small grey metada chip matching the card design system (the `.pill` in the
 * Reference). A compact, bordered, rounded pill used for formats, categories,
 * and counts. Neutral by default; semantic variants tint the pill when an
 * alerting connotation is needed.
 *
 * Usage:
 * ```tsx
 * <Badge>{category}</Badge>
 * <Badge variant="success">FOA</Badge>
 * <Badge variant="neutral" interactive onClick={...}>{count} sources</Badge>
 * ```
 */
import type { MouseEventHandler } from "react";

export type BadgeVariant = "info" | "success" | "warning" | "error" | "primary" | "neutral";

export interface BadgeProps {
  variant?: BadgeVariant;
  /** `xs` = compact label, `sm` = larger pill. */
  size?: "xs" | "sm";
  children: ReactNode;
  className?: string;
  /** Optional click handler — makes the badge an interactive chip. */
  onClick?: MouseEventHandler<HTMLSpanElement>;
  /** Crowd the badge to a normal inline flow (default is inline-flex). */
  inline?: boolean;
  /** Native tooltip text. */
  title?: string;
  /** Adds a recessed dark backing so the badge reads on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  info: "border-info/40 text-info",
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  error: "border-error/40 text-error",
  primary: "border-primary/80 text-primary",
  neutral: "border-border-strong text-secondary-hover",
};

const SIZE_CLASSES = {
  xs: "text-[9.5px] px-1.5 py-[2px] rounded-full",
  sm: "text-[10.5px] px-2 py-0.5 rounded-full",
};

export function Badge({
  variant = "neutral",
  size = "xs",
  children,
  className = "",
  onClick,
  inline = false,
  title,
  onBlueBackground = false,
}: BadgeProps) {
  return (
    <span
      onClick={onClick}
      title={title}
      style={onBlueBackground ? { backgroundColor: 'var(--color-blue-chip-bg)' } : undefined}
      className={`font-medium flex-shrink-0 whitespace-nowrap ${inline ? "inline" : "inline-flex items-center"} border ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${onClick ? "cursor-pointer transition-colors" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

export default Badge;