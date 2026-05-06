'use client';

import React from 'react';
import { UndoRedoToolbar } from '@/components/ui/UndoRedoToolbar';
import { useSpeckleStore } from '@/store';
import { UI_RIGHT_SIDEBAR } from '@/utils/constants';

interface SceneViewModeToolbarProps {
  isRightSidebarExpanded: boolean;
  rightSidebarWidth?: number;
}

export function SceneViewModeToolbar({ isRightSidebarExpanded, rightSidebarWidth }: SceneViewModeToolbarProps) {
  const { viewMode, setViewMode } = useSpeckleStore();

  return (
    <div
      className="absolute top-4 z-20 pointer-events-auto transition-all duration-300 flex flex-col items-end gap-1"
      style={{
        right: isRightSidebarExpanded ? `${(rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) + 20}px` : '20px',
      }}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center">
          <UndoRedoToolbar />
        </div>

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
            { mode: 'acoustic', label: 'Acoustic', title: 'Acoustic mode: layer isolation + material colors' },
            { mode: 'default', label: 'Default', title: 'Default mode: normal view' },
            { mode: 'dark', label: 'Dark', title: 'Dark mode: sound source lighting' },
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
                  borderRight: mode !== 'dark' ? '1px solid rgba(255,255,255,0.12)' : undefined,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
