'use client';

import React from 'react';
import { useSpeckleStore } from '@/store';

export function SceneViewModeToolbar() {
  const { viewMode, setViewMode } = useSpeckleStore();

  return (
    <div
      className="absolute top-4 z-20 pointer-events-auto"
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
          { mode: 'acoustic', label: 'Acoustics', title: 'Acoustic materials layer isolation (needs a simulation tab expanded)' },
        ] as const).map(({ mode, label, title }) => {
          const isActive = viewMode === mode;
          const accentColor = 'var(--color-secondary)';
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
                  ? 'var(--color-primary-hover)'
                  : 'transparent',
                color: isActive ? accentColor : 'rgba(255,255,255,0.55)',
                borderRight: mode !== 'acoustic' ? '1px solid rgba(255,255,255,0.12)' : undefined,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
