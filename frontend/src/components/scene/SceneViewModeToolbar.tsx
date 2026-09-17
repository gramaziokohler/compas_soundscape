'use client';

import React from 'react';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';

export function SceneViewModeToolbar() {
  const { viewMode, setViewMode } = useSpeckleStore();
  const acousticGeometryIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const acousticFaceCount = useAcousticLayerStore((s) => s.selectedAcousticFaceCount);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const hasAcousticRegion = useAcousticLayerStore((s) => s.selectedAcousticLayerIds.length > 0);

  return (
    <div
      className="absolute top-4 z-20 pointer-events-auto flex flex-col items-center gap-1"
      style={{ left: '50%', transform: 'translateX(-50%)' }}
    >
      <div
        className="flex items-center rounded-md overflow-hidden"
        style={{
          backgroundColor: 'var(--color-background)',
          border: '1px solid var(--color-secondary-light)',
        }}
        role="radiogroup"
        aria-label="View mode"
      >
        {([
          { mode: 'dark', label: 'Sounds', title: 'Sound events are represented as blue light' },
          { mode: 'default', label: 'Default', title: 'Architectural viewmode with ambient light' },
          { mode: 'acoustic', label: 'Acoustics', title: 'Acoustics — pick the surfaces that bound your room, assign materials, and run a simulation' },
        ] as const).map(({ mode, label, title }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              role="radio"
              aria-checked={isActive}
              onClick={() => setViewMode(mode)}
              title={title}
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

      {/* Acoustic region status chip — always tells the user what Acoustics mode is showing. */}
      {viewMode === 'acoustic' && (
        <button
          type="button"
          onClick={() => useUIStore.getState().setShowObjectExplorer(true)}
          className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors"
          style={{
            backgroundColor: 'var(--color-overlay-bg)',
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
    </div>
  );
}
