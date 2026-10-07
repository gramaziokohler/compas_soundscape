'use client';

import React, { useEffect, useState } from 'react';
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
  /** Name of the Homepage project the Home stage was loaded from, if any. */
  activeProjectName?: string;
  onImport: () => void;
  /** Save the Home work as a Homepage project (`name` for a new one), then open the model. */
  onSaveAndOpen: (name: string) => void;
  onStartFresh: () => void;
  onCancel: () => void;
}

/**
 * ImportSandboxModal
 *
 * Shown when a model is uploaded or opened from the Home stage while it still
 * holds work. Lets the user import that work into the model, save it as a
 * Homepage project (then open the model), start fresh, or cancel the switch.
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
  activeProjectName,
  onImport,
  onSaveAndOpen,
  onStartFresh,
  onCancel,
}: ImportSandboxModalProps) {
  // Naming step for a new Homepage project (skipped when one is already active).
  const [naming, setNaming] = useState(false);
  const [projectName, setProjectName] = useState('');
  useEffect(() => {
    if (!open) { setNaming(false); setProjectName(''); }
  }, [open]);

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
      role="dialog"
      aria-modal="true"
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
          {parts.length > 0
            ? `Your Home stage contains ${parts.join(', ')}.`
            : 'Your Home stage has unsaved work.'}{' '}
          Import it into this model, or save it as a Homepage project to reopen later.
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
          {naming ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (projectName.trim()) onSaveAndOpen(projectName.trim());
              }}
            >
              <input
                autoFocus
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
                aria-label="Homepage project name"
                className="flex-1 min-w-0 px-2 py-1 text-xs bg-transparent text-foreground outline-none"
                style={{ border: '1px solid var(--color-border-strong)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
              />
              <button
                type="submit"
                disabled={busy || !projectName.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
              >
                Save &amp; open
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => (activeProjectName ? onSaveAndOpen(activeProjectName) : setNaming(true))}
              className="w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-secondary-lighter)', color: 'var(--foreground)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              {activeProjectName ? `Save progress to “${activeProjectName}”, then open` : 'Save as a Homepage project, then open'}
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onStartFresh}
              className="flex-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-secondary-lighter)', color: 'var(--foreground)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              Discard &amp; open
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
