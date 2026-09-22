'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { apiService } from '@/services/api';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { UI_BORDER_RADIUS } from '@/utils/constants';

interface HomeProjectSummary {
  model_id: string;
  name: string;
  saved_at: string;
}

interface HomeProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** Save the current Home scene under the given project name. */
  onSave: (name: string) => void;
  /** Reload a previously saved Home project by model id. */
  onLoad: (modelId: string) => void;
  busy?: boolean;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * HomeProjectModal
 *
 * Save the Home sandbox as a named local "No-model project", or reload one of
 * the projects already saved in this workspace.
 *
 * Usage:
 * ```tsx
 * <HomeProjectModal open={show} onClose={close} onSave={save} onLoad={load} />
 * ```
 */
export function HomeProjectModal({
  open,
  onClose,
  onSave,
  onLoad,
  busy = false,
}: HomeProjectModalProps) {
  const [name, setName] = useState('No-model project');
  const [projects, setProjects] = useState<HomeProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiService.listHomeProjects();
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = name.trim();
  const slug =
    trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const nameTaken = projects.some(
    (p) =>
      p.model_id === `home-${slug}` ||
      p.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)' }}
      onClick={onClose}
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
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">No-model project</p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-secondary-hover hover:text-foreground px-1"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-1 mt-3">
          <label className="text-[10px] text-secondary-hover">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-xs px-2 py-1.5 rounded bg-background text-foreground outline-none"
            style={{ border: '1px solid var(--color-border)' }}
            placeholder="No-model project"
          />
          {nameTaken && trimmed.length > 0 && (
            <div className="mt-2">
              <Notice
                type="warning"
                variant="tag"
                message="A project with this name already exists — saving will overwrite it."
              />
            </div>
          )}
          <button
            type="button"
            disabled={busy || trimmed.length === 0}
            onClick={() => onSave(trimmed)}
            className="mt-2 w-full py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--color-primary)',
              color: 'var(--color-on-blue)',
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            }}
          >
            {busy ? 'Saving…' : nameTaken ? 'Overwrite no-model project' : 'Save no-model project'}
          </button>
        </div>

        <div className="mt-4">
          <p className="text-[10px] text-secondary-hover mb-2">Saved no-model projects</p>
          {isLoading ? (
            <div className="flex justify-center py-3">
              <Spinner size={18} />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState message="No saved no-model projects yet." />
          ) : (
            <div className="flex flex-col gap-1.5" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {projects.map((p) => (
                <button
                  key={p.model_id}
                  type="button"
                  onClick={() => onLoad(p.model_id)}
                  className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded transition-colors hover:border-primary"
                  style={{ border: '1px solid var(--color-border)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
                >
                  <span className="text-xs text-foreground truncate">{p.name}</span>
                  <span className="text-[10px] text-secondary-hover whitespace-nowrap">
                    {formatRelativeTime(p.saved_at)} · Open
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
