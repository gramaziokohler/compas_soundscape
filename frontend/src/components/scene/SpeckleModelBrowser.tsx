'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { apiService } from '@/services/api';
import { UI_COLORS } from '@/utils/constants';
import type { SpeckleModelDetail, SpeckleProjectModelsResponse } from '@/types/speckle-models';

// ============================================================================
// Constants
// ============================================================================

const SPECKLE_SERVER_HOST = 'app.speckle.systems';

const MODEL_BROWSER_STYLES = {
  MAX_HEIGHT: 220,
  CARD_GAP: 8,
  CARD_PADDING: 10,
  CARD_BORDER_RADIUS: 8,
  PREVIEW_SIZE: 48,
  DESCRIPTION_MAX_LENGTH: 60,
} as const;

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
}

interface SpeckleModelBrowserProps {
  /** Called when a model card is clicked; passes a SpeckleData payload */
  onModelSelect: (speckleData: SpeckleData) => void;
}

// ============================================================================
// Helpers
// ============================================================================

/** Format an ISO date string as a relative time label (e.g. "2 days ago") */
function formatRelativeTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffDays > 30) return date.toLocaleDateString();
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHrs > 0) return `${diffHrs}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}

/** Truncate text to a max length with ellipsis */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
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
        backgroundColor: UI_COLORS.NEUTRAL_100,
        color: UI_COLORS.NEUTRAL_400,
        fontSize: 22,
        flexShrink: 0,
      }}
    >
      🧊
    </div>
  );
}

/** Single model card */
function ModelCard({
  model,
  onSelect,
}: {
  model: SpeckleModelDetail;
  onSelect: () => void;
}) {
  const sourceApp = model.latest_version?.source_application;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left transition-colors"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: MODEL_BROWSER_STYLES.CARD_GAP + 2,
        padding: MODEL_BROWSER_STYLES.CARD_PADDING,
        borderRadius: MODEL_BROWSER_STYLES.CARD_BORDER_RADIUS,
        border: `1px solid ${UI_COLORS.NEUTRAL_200}`,
        background: 'white',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = UI_COLORS.PRIMARY;
        (e.currentTarget as HTMLButtonElement).style.background = UI_COLORS.PRIMARY_LIGHT;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = UI_COLORS.NEUTRAL_200;
        (e.currentTarget as HTMLButtonElement).style.background = 'white';
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
        <p className="text-xs font-medium truncate" style={{ color: UI_COLORS.NEUTRAL_800 }}>
          {model.display_name}
        </p>

        {model.description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: UI_COLORS.NEUTRAL_500 }}>
            {truncate(model.description, MODEL_BROWSER_STYLES.DESCRIPTION_MAX_LENGTH)}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1">
          {sourceApp && (
            <span
              className="text-xs px-1 rounded"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_100, color: UI_COLORS.NEUTRAL_500 }}
            >
              {sourceApp}
            </span>
          )}
          {model.versions_count > 0 && (
            <span className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              v{model.versions_count}
            </span>
          )}
          {model.updated_at && (
            <span className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              {formatRelativeTime(model.updated_at)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Main component
// ============================================================================

/**
 * SpeckleModelBrowser
 *
 * Lists available Speckle project models. Clicking a model constructs a
 * `SpeckleData` payload and calls `onModelSelect` so the viewer can load it.
 */
export function SpeckleModelBrowser({ onModelSelect }: SpeckleModelBrowserProps) {
  const [models, setModels] = useState<SpeckleModelDetail[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      };

      onModelSelect(speckleData);
    },
    [projectId, authToken, onModelSelect],
  );

  // ── Loading state ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="w-full text-center py-4">
        <div
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"
          style={{ color: UI_COLORS.PRIMARY }}
          role="status"
        />
        <p className="text-xs mt-2" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Loading models...
        </p>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="w-full text-center py-3">
        <p className="text-xs mb-2" style={{ color: UI_COLORS.ERROR }}>
          {error}
        </p>
        <button
          type="button"
          onClick={fetchModels}
          className="text-xs px-3 py-1 rounded transition-colors"
          style={{
            border: `1px solid ${UI_COLORS.NEUTRAL_300}`,
            color: UI_COLORS.NEUTRAL_600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (models.length === 0) {
    return (
      <div className="w-full text-center py-3">
        <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
          No models found in project
        </p>
      </div>
    );
  }

  // ── Model list ─────────────────────────────────────────────────────────
  // Filter out models without a usable latest_version
  const loadableModels = models.filter((m) => m.latest_version);

  if (loadableModels.length === 0) {
    return (
      <div className="w-full text-center py-3">
        <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
          No loadable models (no versions available)
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="text-xs font-medium mb-2" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        Or load from Speckle
      </p>

      <div
        className="flex flex-col"
        style={{
          gap: MODEL_BROWSER_STYLES.CARD_GAP,
          maxHeight: MODEL_BROWSER_STYLES.MAX_HEIGHT,
          overflowY: 'auto',
        }}
      >
        {loadableModels.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            onSelect={() => handleSelect(model)}
          />
        ))}
      </div>
    </div>
  );
}
