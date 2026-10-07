'use client';

import { useEffect } from 'react';
import { UI_BORDER_RADIUS } from '@/utils/constants';

interface WorkspaceJoinDialogProps {
  open: boolean;
  /** Name of the shared workspace that was just joined. */
  workspaceName?: string;
  /** Display name of the model the invite was scoped to. */
  modelName?: string;
  busy?: boolean;
  /** Open the sharer's saved soundscape (stays in the shared workspace). */
  onOpenShared: () => void;
  /** Open the user's own saved soundscape (switches back to their workspace). */
  onOpenMine: () => void;
}

/**
 * WorkspaceJoinDialog
 *
 * Shown after accepting a model-scoped invite when the recipient already has
 * their own saved soundscape for that same model. Both versions live in their
 * respective workspaces (a model can have one soundscape per workspace); this
 * lets the recipient choose which one to open. They can switch any time from
 * Advanced settings → Workspaces.
 *
 * Usage:
 * ```tsx
 * <WorkspaceJoinDialog
 *   open={!!choice}
 *   workspaceName={choice?.sharedName}
 *   modelName="Office"
 *   onOpenShared={() => openShared()}
 *   onOpenMine={() => openMine()}
 * />
 * ```
 */
export function WorkspaceJoinDialog({
  open,
  workspaceName,
  modelName,
  busy = false,
  onOpenShared,
  onOpenMine,
}: WorkspaceJoinDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape defaults to the shared version so the page never gets stuck.
      if (e.key === 'Escape') onOpenShared();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenShared]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)' }}
      onClick={busy ? undefined : onOpenShared}
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
        <p className="text-sm font-semibold text-foreground">Join shared workspace</p>
        <p className="text-xs mt-2 text-secondary-hover">
          You already have a saved soundscape for
          {modelName ? ` “${modelName}”` : ' this model'}
          {workspaceName ? `, and you just joined “${workspaceName}”.` : '.'}
        </p>
        <p className="text-[11px] mt-1 text-secondary-hover opacity-80">
          Both versions are kept, one per workspace. Choose which to open — you can switch
          between them any time in Advanced settings.
        </p>

        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={onOpenShared}
            className="w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--color-primary)',
              color: 'var(--color-on-blue)',
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            }}
          >
            {busy ? 'Opening…' : 'Open shared version'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onOpenMine}
            className="w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--color-secondary-lighter)',
              color: 'var(--foreground)',
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            }}
          >
            Open my version
          </button>
        </div>
      </div>
    </div>
  );
}

export type { WorkspaceJoinDialogProps };
