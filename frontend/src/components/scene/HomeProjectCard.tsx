'use client';

import React, { useState } from 'react';
import { apiService } from '@/services/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModelCardMenu, ModelCardMenuItem, ModelCardMenuTrigger, TrashIcon } from '@/components/scene/ModelCardMenu';
import { MODEL_BROWSER_STYLES, MODEL_CARD_CLASS, formatRelativeTime } from '@/components/scene/modelBrowserShared';

export interface HomeProjectSummary {
  model_id: string;
  name: string;
  saved_at: string;
}

interface HomeProjectCardProps {
  project: HomeProjectSummary;
  onSelect: () => void;
  /** Called after the project was deleted on the backend. */
  onDeleted: (modelId: string) => void;
}

/**
 * HomeProjectCard
 *
 * Load-model list card for a saved local "No-model" project, with a kebab
 * menu offering Delete (confirmed inline before the backend call).
 */
export function HomeProjectCard({ project, onSelect, onDeleted }: HomeProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await apiService.deleteSoundscapeHistory(project.model_id);
      onDeleted(project.model_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={onSelect}
          disabled={deleting}
          className={MODEL_CARD_CLASS}
          style={{
            gap: MODEL_BROWSER_STYLES.CARD_GAP + 2,
            padding: MODEL_BROWSER_STYLES.CARD_PADDING,
            paddingRight: MODEL_BROWSER_STYLES.CARD_PADDING_RIGHT,
            borderRadius: MODEL_BROWSER_STYLES.CARD_BORDER_RADIUS,
          }}
        >
          <div
            className="flex items-center justify-center rounded"
            style={{
              width: MODEL_BROWSER_STYLES.PREVIEW_SIZE,
              height: MODEL_BROWSER_STYLES.PREVIEW_SIZE,
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-secondary-hover)',
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            🏠
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate text-foreground">{project.name}</p>
            <p className="text-xs mt-0.5 truncate text-neutral-500">
              No-model project · {formatRelativeTime(project.saved_at)}
            </p>
          </div>
        </button>

        <ModelCardMenuTrigger open={menuOpen} onToggle={() => setMenuOpen((o) => !o)} />
        {menuOpen && (
          <ModelCardMenu onClose={() => setMenuOpen(false)}>
            <ModelCardMenuItem
              icon={<TrashIcon />}
              label="Delete project"
              danger
              onClick={() => {
                setMenuOpen(false);
                setConfirming(true);
              }}
            />
          </ModelCardMenu>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={error ?? `Delete "${project.name}"? Its sounds and settings will be removed permanently.`}
          confirmLabel={deleting ? 'Deleting' : 'Delete'}
          variant="danger"
          disabled={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            setConfirming(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
