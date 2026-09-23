'use client';

import React, { useEffect } from 'react';
import { UI_BORDER_RADIUS } from '@/utils/constants';

interface NewModelVersionModalProps {
  open: boolean;
  modelName: string;
  /** Newer version metadata (already fetched by the watcher). */
  createdAt?: string;
  authorName?: string;
  message?: string;
  busy?: boolean;
  onSwitch: () => void;
  onKeepCurrent: () => void;
}

/**
 * NewModelVersionModal
 *
 * Shown when a newer version of the currently open Speckle model has been
 * published. Lets the user switch the viewer to the latest version or keep
 * working on the version currently loaded.
 *
 * Usage:
 * ```tsx
 * <NewModelVersionModal
 *   open={!!pending}
 *   modelName="Office"
 *   createdAt={pending?.created_at}
 *   authorName={pending?.author_name}
 *   message={pending?.message}
 *   busy={busy}
 *   onSwitch={switchToLatest}
 *   onKeepCurrent={dismiss}
 * />
 * ```
 */
export function NewModelVersionModal({
  open,
  modelName,
  createdAt,
  authorName,
  message,
  busy = false,
  onSwitch,
  onKeepCurrent,
}: NewModelVersionModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKeepCurrent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onKeepCurrent]);

  if (!open) return null;

  const details: string[] = [];
  if (authorName) details.push(`by ${authorName}`);
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!isNaN(parsed.getTime())) details.push(parsed.toLocaleString());
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)' }}
      onClick={busy ? undefined : onKeepCurrent}
    >
      <div
        className="frosted-surface backdrop-blur-lg backdrop-saturate-150 shadow-lg"
        style={{
          width: 'min(92vw, 26rem)',
          border: '1px solid var(--color-overlay-border)',
          borderRadius: `${UI_BORDER_RADIUS.MD}px`,
          background: 'var(--color-overlay-bg)',
          padding: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-foreground">New model version available</p>
        <p className="text-xs mt-2 text-secondary-hover">
          A newer version of “{modelName}” has been published.
          {details.length > 0 ? ` (${details.join(', ')})` : ''}
        </p>
        {message && (
          <p className="text-[11px] mt-1 text-secondary-hover opacity-80 italic line-clamp-2">
            {message}
          </p>
        )}
        <p className="text-[11px] mt-1 text-secondary-hover opacity-80">
          Switch to load the updated geometry and re-link your sounds. Your soundscape is kept.
        </p>

        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={onSwitch}
            className="w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--color-primary)',
              color: 'var(--color-on-blue)',
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            }}
          >
            {busy ? 'Switching…' : 'Switch to latest version'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onKeepCurrent}
            className="w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--color-secondary-lighter)',
              color: 'var(--foreground)',
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            }}
          >
            Keep current version
          </button>
        </div>
      </div>
    </div>
  );
}
