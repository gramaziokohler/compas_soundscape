"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Primary message shown in muted text. */
  message: string;
  /** Optional icon rendered above the message. */
  icon?: ReactNode;
  /** Optional action (e.g. a button) rendered below the message. */
  action?: ReactNode;
  className?: string;
  /** Set when rendered directly on the frosted sidebar glass (no solid card
   * behind it) — uses adaptive-contrast text instead of the static muted gray. */
  onGlass?: boolean;
}

/**
 * EmptyState Component
 *
 * Persistent placeholder for sections/lists that have no content to show.
 *
 * Usage:
 * ```tsx
 * <EmptyState message="No models found." action={<RetryButton />} />
 * ```
 */
export function EmptyState({ message, icon, action, className = "", onGlass = false }: EmptyStateProps) {
  const textColorClass = onGlass ? "text-adaptive" : "text-secondary-hover";
  return (
    <div className={`w-full text-center py-4 flex flex-col items-center gap-2 ${className}`}>
      {icon && <div className={`${textColorClass} flex-shrink-0`}>{icon}</div>}
      <p className={`text-xs ${textColorClass}`}>{message}</p>
      {action && <div className="flex items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
