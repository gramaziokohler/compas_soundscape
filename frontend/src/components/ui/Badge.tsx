"use client";

import type { ReactNode } from "react";

export type BadgeVariant = "info" | "success" | "warning" | "error" | "primary" | "neutral";

interface BadgeProps {
  variant?: BadgeVariant;
  /** `xs` = square corner (compact labels), `sm` = pill (status chips). */
  size?: "xs" | "sm";
  children: ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  info: "bg-info-light text-info",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  error: "bg-error-light text-error",
  primary: "bg-primary-light text-primary",
  neutral: "bg-secondary-light text-secondary-hover",
};

const SIZE_CLASSES = {
  xs: "text-[9px] px-1.5 py-0.5 rounded",
  sm: "text-[10px] px-2 py-0.5 rounded-full",
};

/**
 * Badge Component
 *
 * Compact label for formats, categories, and counts.
 *
 * Usage:
 * ```tsx
 * <Badge variant="success">FOA</Badge>
 * <Badge variant="neutral">{soundCount}</Badge>
 * ```
 */
export function Badge({ variant = "neutral", size = "xs", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium flex-shrink-0 whitespace-nowrap ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
