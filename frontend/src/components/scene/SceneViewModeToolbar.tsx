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
          backgroundColor: 'rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
        role="radiogroup"
        aria-label="View mode"
      >
        {([
          { mode: 'dark', label: 'Sounds', title: 'Sounds mode: sound source lighting' },
          { mode: 'default', label: 'Default', title: 'Default mode: normal view' },
          { mode: 'acoustic', label: 'Acoustic', title: 'Acoustic mode: layer isolation + material colors' },
        ] as const).map(({ mode, label, title }) => {
          const isActive = viewMode === mode;
          const accentColor = mode === 'dark' ? 'var(--color-primary)' : 'var(--color-info)';
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
                  ? mode === 'dark'
                    ? 'rgba(0,212,255,0.18)'
                    : 'rgba(0,212,255,0.13)'
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
