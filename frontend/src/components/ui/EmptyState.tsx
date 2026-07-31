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
export function EmptyState({ message, icon, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`w-full text-center py-4 flex flex-col items-center gap-2 ${className}`}>
      {icon && <div className="text-secondary-hover flex-shrink-0">{icon}</div>}
      <p className="text-xs text-secondary-hover">{message}</p>
      {action && <div className="flex items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
