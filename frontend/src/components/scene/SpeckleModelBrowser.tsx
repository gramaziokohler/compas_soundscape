'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiService } from '@/services/api';
import { isAuthError } from '@/utils/authErrors';
import { useTextGenerationStore } from '@/store/textGenerationStore';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { Badge } from '@/components/ui/Badge';
import { HomeProjectCard, type HomeProjectSummary } from '@/components/scene/HomeProjectCard';
import { ExternalLinkIcon, ModelCardMenu, ModelCardMenuItem, ModelCardMenuTrigger } from '@/components/scene/ModelCardMenu';
import { MODEL_BROWSER_STYLES, MODEL_CARD_CLASS, formatRelativeTime } from '@/components/scene/modelBrowserShared';
import type { SpeckleModelDetail, SpeckleProjectModelsResponse } from '@/types/speckle-models';
import { getScale } from '@/utils/scale';

// ============================================================================
// Constants
// ============================================================================

const SPECKLE_SERVER_HOST = 'app.speckle.systems';

// ============================================================================
// Types
// ============================================================================

/** SpeckleData shape expected by SpeckleScene / page.tsx */
interface SpeckleData {
  model_id: string;
  version_id: string;
  file_id: string;
  url: string;
  object_id: string;
  auth_token?: string;
  display_name?: string;
}

interface SpeckleModelBrowserProps {
  /** Called when a model card is clicked; passes a SpeckleData payload */
  onModelSelect: (speckleData: SpeckleData) => void;
  /**
   * When provided, saved local "No-model" projects are listed alongside the
   * Speckle models (one list, newest first). Selecting one loads it.
   */
  onLoadHomeProject?: (modelId: string) => void;
}

/** One row of the merged list, keyed by its modified date for sorting. */
type BrowserEntry =
  | { kind: 'home'; key: string; time: number; project: HomeProjectSummary }
  | { kind: 'speckle'; key: string; time: number; model: SpeckleModelDetail };

// ============================================================================
// Helpers
// ============================================================================

/** Truncate text to a max length with ellipsis */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Modified date of a Speckle model: this workspace's last save, else Speckle's update. */
function speckleModifiedTime(model: SpeckleModelDetail): number {
  return new Date(model.last_saved_at ?? model.updated_at ?? 0).getTime();
}

// ============================================================================
// Sub-components
// ============================================================================

/** Fallback icon when no preview image is available */
function ModelFallbackIcon() {
  return (
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
      🧊
    </div>
  );
}

/** Single Speckle model card */
function ModelCard({
  model,
  projectId,
  onSelect,
}: {
  model: SpeckleModelDetail;
  projectId: string;
  onSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sourceApp = model.latest_version?.source_application;
  const modelUrl = `https://${SPECKLE_SERVER_HOST}/projects/${projectId}/models/${model.id}`;

  return (
    <div style={{ position: 'relative' }}>
      {/* Clickable card body */}
      <button
        type="button"
        onClick={onSelect}
        className={MODEL_CARD_CLASS}
        style={{
          gap: MODEL_BROWSER_STYLES.CARD_GAP + 2,
          padding: MODEL_BROWSER_STYLES.CARD_PADDING,
          paddingRight: MODEL_BROWSER_STYLES.CARD_PADDING_RIGHT,
          borderRadius: MODEL_BROWSER_STYLES.CARD_BORDER_RADIUS,
        }}
      >
        {/* Preview / fallback icon */}
        {model.preview_url ? (
          <img
            src={model.preview_url}
            alt={model.display_name}
            className="rounded object-cover"
            style={{
              width: MODEL_BROWSER_STYLES.PREVIEW_SIZE,
              height: MODEL_BROWSER_STYLES.PREVIEW_SIZE,
              flexShrink: 0,
            }}
          />
        ) : (
          <ModelFallbackIcon />
        )}

        {/* Model info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground">
            {model.display_name}
          </p>

          {model.description && (
            <p className="text-xs mt-0.5 truncate text-neutral-500">
              {truncate(model.description, MODEL_BROWSER_STYLES.DESCRIPTION_MAX_LENGTH)}
            </p>
          )}

          <div className="flex items-center gap-2 mt-1">
            {sourceApp && (
              <span
                className="text-xs px-1 rounded"
                title={sourceApp}
                style={{ backgroundColor: 'var(--color-secondary-lighter)', color: 'var(--color-secondary-hover)' }}
              >
                {sourceApp.slice(0, 3)}
              </span>
            )}
            {model.last_saved_at ? (
              <>
                <Badge variant="primary" title="Last saved by you in this workspace">
                  Yours
                </Badge>
                <span className="text-xs text-neutral-500">
                  saved {formatRelativeTime(model.last_saved_at)}
                </span>
              </>
            ) : (
              model.versions_count > 0 && (
                <span className="text-xs text-neutral-400">
                  {formatRelativeTime(model.updated_at)}
                </span>
              )
            )}
          </div>
        </div>
      </button>

      <ModelCardMenuTrigger open={menuOpen} onToggle={() => setMenuOpen((o) => !o)} />
      {menuOpen && (
        <ModelCardMenu onClose={() => setMenuOpen(false)}>
          <ModelCardMenuItem
            icon={<ExternalLinkIcon />}
            label="Open in Speckle app"
            href={modelUrl}
            onClick={() => setMenuOpen(false)}
          />
        </ModelCardMenu>
      )}
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

/**
 * SpeckleModelBrowser
 *
 * One scrollable list of saved No-model projects and Speckle project models,
 * newest-modified first. Clicking a Speckle model constructs a `SpeckleData`
 * payload and calls `onModelSelect`; clicking a No-model project calls
 * `onLoadHomeProject`.
 */
export function SpeckleModelBrowser({ onModelSelect, onLoadHomeProject }: SpeckleModelBrowserProps) {
  const [models, setModels] = useState<SpeckleModelDetail[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [homeProjects, setHomeProjects] = useState<HomeProjectSummary[]>([]);

  const fetchHomeProjects = useCallback(async () => {
    try {
      const data = await apiService.listHomeProjects();
      setHomeProjects(data.projects ?? []);
    } catch {
      setHomeProjects([]);
    }
  }, []);

  useEffect(() => {
    void fetchHomeProjects();
  }, [fetchHomeProjects]);

  const fetchModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data: SpeckleProjectModelsResponse = await apiService.getSpeckleModels();
      setModels(data.models);
      setProjectId(data.project_id);
      setAuthToken(data.auth_token ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load models';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  /** Build SpeckleData from a model and call the parent handler */
  const handleSelect = useCallback(
    (model: SpeckleModelDetail) => {
      const latestVersion = model.latest_version;
      if (!latestVersion) return;

      const speckleData: SpeckleData = {
        model_id: model.id,
        version_id: latestVersion.id,
        file_id: '',
        url: `https://${SPECKLE_SERVER_HOST}/projects/${projectId}/models/${model.id}`,
        object_id: latestVersion.referenced_object ?? latestVersion.id,
        auth_token: authToken,
        display_name: model.display_name,
      };

      onModelSelect(speckleData);
    },
    [projectId, authToken, onModelSelect],
  );

  const handleHomeProjectDeleted = useCallback((modelId: string) => {
    setHomeProjects((prev) => prev.filter((p) => p.model_id !== modelId));
  }, []);

  // Merge No-model projects and loadable Speckle models into one list,
  // ordered by modified date (newest first).
  const entries = useMemo<BrowserEntry[]>(() => {
    const home: BrowserEntry[] = onLoadHomeProject
      ? homeProjects.map((p) => ({
          kind: 'home',
          key: `home:${p.model_id}`,
          time: new Date(p.saved_at).getTime(),
          project: p,
        }))
      : [];
    const speckle: BrowserEntry[] = models
      .filter((m) => m.latest_version)
      .map((m) => ({ kind: 'speckle', key: `speckle:${m.id}`, time: speckleModifiedTime(m), model: m }));
    return [...home, ...speckle].sort((a, b) => b.time - a.time);
  }, [homeProjects, models, onLoadHomeProject]);

  const renderEntry = (entry: BrowserEntry) =>
    entry.kind === 'home' ? (
      <HomeProjectCard
        key={entry.key}
        project={entry.project}
        onSelect={() => onLoadHomeProject?.(entry.project.model_id)}
        onDeleted={handleHomeProjectDeleted}
      />
    ) : (
      <ModelCard
        key={entry.key}
        model={entry.model}
        projectId={projectId}
        onSelect={() => handleSelect(entry.model)}
      />
    );

  // ── Status below the list (loading / error / empty) ───────────────────
  const renderStatus = () => {
    if (isLoading) {
      return (
        <div className="w-full text-center py-4">
          <Spinner size={20} />
          <p className="text-xs mt-2 text-neutral-500">Loading models...</p>
        </div>
      );
    }
    if (error) {
      const isAuth = isAuthError(error);
      return (
        <div className="w-full py-3 flex flex-col gap-2">
          <Notice type="error" message={error} />
          {isAuth ? (
            <button
              type="button"
              onClick={() => useTextGenerationStore.getState().triggerOpenTokenSettings()}
              className="self-start text-xs px-3 py-1 rounded transition-colors"
              style={{
                border: `1px solid var(--color-secondary-light)`,
                color: 'var(--color-secondary-hover)',
              }}
            >
              Configure API token in Advanced Settings →
            </button>
          ) : null}
          <button
            type="button"
            onClick={fetchModels}
            className="self-start text-xs px-3 py-1 rounded transition-colors"
            style={{
              border: `1px solid var(--color-secondary-light)`,
              color: 'var(--color-secondary-hover)',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    if (entries.length === 0) {
      return (
        <EmptyState message={models.length === 0 ? 'No models found.' : 'No loadable models available.'} />
      );
    }
    return null;
  };

  return (
    <div className="w-full flex flex-col gap-2">
      {entries.length > 0 && (
        <div
          className="flex flex-col"
          style={{
            gap: MODEL_BROWSER_STYLES.CARD_GAP,
            maxHeight: Math.min(MODEL_BROWSER_STYLES.MAX_HEIGHT, getScale().viewport.height * 0.4),
            overflowY: 'auto',
            overflowX: 'visible',
          }}
        >
          {entries.map(renderEntry)}
        </div>
      )}
      {renderStatus()}
    </div>
  );
}
