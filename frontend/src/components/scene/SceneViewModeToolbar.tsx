'use client';

import { useState } from 'react';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { useCanEdit } from '@/hooks/useCanEdit';
import { VIEW_MODE_TOOLBAR_ID } from '@/utils/constants';
import { AbsorptionLegend } from '@/components/scene/AbsorptionLegend';

type ViewMode = 'dark' | 'default' | 'acoustic';

const VIEW_MODES: { mode: ViewMode; label: string; description: string }[] = [
  { mode: 'dark', label: 'Sounds', description: 'Sounds are represented as blue light' },
  { mode: 'default', label: 'Default', description: 'Shaded — ambient light' },
  { mode: 'acoustic', label: 'Acoustics', description: 'Simplified acoustic model for simulation' },
];

/**
 * SceneViewModeToolbar Component
 *
 * Top-center `Sounds | Default | Acoustics` segmented pill. Hovering it pops the
 * same frosted label the Simple-mode circles use: "View mode" plus a one-line
 * description of the hovered item (or of the active one between items).
 * In Acoustics mode the editor shows the acoustic-region status chip under it,
 * the share view the absorption colour key (AbsorptionLegend) instead.
 */
export function SceneViewModeToolbar() {
  const viewMode = useSpeckleStore((s) => s.viewMode);
  const setViewMode = useSpeckleStore((s) => s.setViewMode);
  const acousticGeometryIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const acousticFaceCount = useAcousticLayerStore((s) => s.selectedAcousticFaceCount);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const hasAcousticRegion = useAcousticLayerStore((s) => s.selectedAcousticLayerIds.length > 0);
  const [hovered, setHovered] = useState<ViewMode | null>(null);
  const canEdit = useCanEdit();
  const described = VIEW_MODES.find((m) => m.mode === (hovered ?? viewMode));

  return (
    <div
      className="absolute top-4 z-20 pointer-events-auto flex flex-col items-center gap-1"
      style={{ left: '50%', transform: 'translateX(-50%)' }}
    >
      <div className="bubble-wrap" onMouseLeave={() => setHovered(null)}>
      <div
        id={VIEW_MODE_TOOLBAR_ID}
        className="flex items-center rounded-md overflow-hidden frosted-surface backdrop-blur-lg backdrop-saturate-150"
        style={{
          border: '1px solid var(--color-secondary-light)',
        }}
        role="radiogroup"
        aria-label="View mode"
      >
        {VIEW_MODES.map(({ mode, label, description }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              role="radio"
              aria-checked={isActive}
              aria-description={description}
              onClick={() => setViewMode(mode)}
              onMouseEnter={() => setHovered(mode)}
              className="px-2.5 py-1 text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: isActive
                  ? 'var(--color-primary)'
                  : 'transparent',
                color: isActive ? 'var(--color-on-blue)' : 'var(--color-secondary-hover)',
                borderRight: mode !== 'acoustic' ? '1px solid var(--color-border-strong)' : undefined,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
        {/* Hover label — same frosted pill as the Simple-mode circles */}
        <div
          className="bubble-label bubble-label--right sidebar-toggle-label backdrop-blur-lg backdrop-saturate-150"
          aria-hidden="true"
        >
          <span className="bubble-label__title">View mode</span>
          {described && <span className="bubble-label__detail">{described.description}</span>}
        </div>
      </div>

      {/* Acoustic region status chip (editor) — tells the designer what Acoustics mode is showing. */}
      {viewMode === 'acoustic' && canEdit && (
        <button
          type="button"
          onClick={() => useUIStore.getState().setShowObjectExplorer(true)}
          className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors frosted-surface backdrop-blur-lg backdrop-saturate-150"
          style={{
            border: '1px solid var(--color-overlay-border)',
            color: 'var(--color-secondary-hover)',
          }}
          title="Open the Object Explorer to change the acoustic region"
        >
          {hasAcousticRegion
            ? (isWholeModel
              ? `Acoustic region · whole model · ${acousticFaceCount.toLocaleString()} faces`
              : `Acoustic region · ${acousticGeometryIds.length} surface${acousticGeometryIds.length === 1 ? '' : 's'} · ${acousticFaceCount.toLocaleString()} faces`)
            : 'No acoustic region yet — pick surfaces'}
        </button>
      )}

      {/* Share view: what the Acoustics colours mean. */}
      {viewMode === 'acoustic' && !canEdit && <AbsorptionLegend />}
    </div>
  );
}
