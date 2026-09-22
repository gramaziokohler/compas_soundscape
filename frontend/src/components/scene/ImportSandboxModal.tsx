'use client';

import React, { useEffect } from 'react';
import { UI_BORDER_RADIUS } from '@/utils/constants';

export interface ImportSandboxSummary {
  sounds: number;
  listeners: number;
  gridListeners: number;
}

interface ImportSandboxModalProps {
  open: boolean;
  modelName: string;
  summary: ImportSandboxSummary;
  busy?: boolean;
  onImport: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
}

/**
 * ImportSandboxModal
 *
 * Shown when a model is opened from the Home stage while it still holds
 * elements. Lets the user non-destructively import those elements into the
 * model, start fresh, or cancel the switch.
 *
 * Usage:
 * ```tsx
 * <ImportSandboxModal open={!!pending} modelName="Office" summary={{...}}
 *   onImport={...} onStartFresh={...} onCancel={...} />
 * ```
 */
export function ImportSandboxModal({
  open,
  modelName,
  summary,
  busy = false,
  onImport,
  onStartFresh,
  onCancel,
}: ImportSandboxModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const parts: string[] = [];
  if (summary.sounds > 0) parts.push(`${summary.sounds} sound${summary.sounds === 1 ? '' : 's'}`);
  if (summary.listeners > 0) parts.push(`${summary.listeners} listener${summary.listeners === 1 ? '' : 's'}`);
  if (summary.gridListeners > 0) parts.push(`${summary.gridListeners} listener grid${summary.gridListeners === 1 ? '' : 's'}`);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)' }}
      onClick={onCancel}
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
        <p className="text-sm font-semibold text-foreground">Open “{modelName}”</p>
        <p className="text-xs mt-2 text-secondary-hover">
          Your Home stage still contains {parts.join(', ')}. Import them into this model, or start fresh.
        </p>
        <p className="text-[11px] mt-1 text-secondary-hover opacity-80">
          Only sounds and listeners are imported (simulations and analysis stay on the Home stage).
        </p>

        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={onImport}
            className="w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          >
            Import elements into the model
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onStartFresh}
              className="flex-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-secondary-lighter)', color: 'var(--foreground)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              Start fresh
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="flex-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-secondary-lighter)', color: 'var(--foreground)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
