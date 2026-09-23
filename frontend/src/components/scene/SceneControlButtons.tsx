'use client';

import React, { useState, useCallback } from 'react';
import { SceneControlButton } from '@/components/ui/SceneControlButton';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { Icon, RefreshIcon } from '@/components/ui/Icon';
import { UI_SCENE_BUTTON, UI_RIGHT_SIDEBAR } from '@/utils/constants';
import type { SoundEvent } from '@/types';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

interface SceneControlButtonsProps {
  isViewerReady: boolean;
  isRightSidebarExpanded: boolean;
  rightSidebarWidth?: number;
  audioOrchestrator: AudioOrchestrator | null;
  soundscapeData: SoundEvent[] | null;
  onResetZoom: () => void;
  onRefreshScene: () => void;
  /** Shows a warning indicator on the Refresh scene button (a newer model version is available). */
  showUpdateBadge?: boolean;
  /** Extra bottom offset (px) so the docked DAW timeline doesn't cover these controls. */
  bottomOffset?: number;
}

export function SceneControlButtons({
  isViewerReady,
  isRightSidebarExpanded,
  rightSidebarWidth,
  audioOrchestrator,
  soundscapeData,
  onResetZoom,
  onRefreshScene,
  showUpdateBadge = false,
  bottomOffset = 0,
}: SceneControlButtonsProps) {
  const [globalVolume, setGlobalVolume] = useState(0.8);
  const [isHoveringVolume, setIsHoveringVolume] = useState(false);

  const handleGlobalVolumeChange = useCallback((value: number) => {
    setGlobalVolume(value);
    if (audioOrchestrator) audioOrchestrator.setMasterVolume(value);
  }, [audioOrchestrator]);

  const handleToggleVolumeSlider = useCallback(() => {
    if (globalVolume > 0) {
      handleGlobalVolumeChange(0);
    } else {
      handleGlobalVolumeChange(0.8);
    }
  }, [globalVolume, handleGlobalVolumeChange]);

  if (!isViewerReady) return null;

  return (
    <div
      className="absolute flex flex-col items-center pointer-events-auto z-20 transition-all duration-300"
      style={{
        gap: UI_SCENE_BUTTON.GAP,
        bottom: `${48 + bottomOffset}px`,
        right: isRightSidebarExpanded ? `${(rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) + 10}px` : '10px',
      }}
    >
      {/* Global Volume Control with Hover Slider */}
      <div
        className="relative flex items-center"
        onMouseEnter={() => setIsHoveringVolume(true)}
        onMouseLeave={() => setIsHoveringVolume(false)}
      >
        {isHoveringVolume && (
          <div
            data-volume-slider
            className="absolute bottom-full mb-1 flex items-center justify-center"
            style={{ left: '50%', transform: 'translateX(-50%)' }}
          >
            <VerticalVolumeSlider value={globalVolume} onChange={handleGlobalVolumeChange} defaultValue={0.8} precision={2} />
          </div>
        )}
        <div data-volume-button>
          <SceneControlButton
            onClick={handleToggleVolumeSlider}
            isActive={globalVolume === 0}
            activeColor={'var(--color-warning)'}
            title="Global Volume"
            icon={
              globalVolume === 0 ? (
                <Icon>
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </Icon>
              ) : (
                <Icon>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </Icon>
              )
            }
          />
        </div>
      </div>

      {/* Reset Zoom */}
      <SceneControlButton
        onClick={onResetZoom}
        title="Reset camera view"
        icon={
          <Icon>
            <rect x="3" y="3" width="18" height="18" strokeDasharray="3 3" />
          </Icon>
        }
      />

      {/* Refresh Scene */}
      <div className="relative flex items-center justify-center">
        <SceneControlButton
          onClick={onRefreshScene}
          title={showUpdateBadge ? 'New model version available — refresh scene' : 'Refresh scene'}
          isActive={showUpdateBadge}
          activeColor="var(--color-warning)"
          icon={
            <RefreshIcon size="0.8rem" />
          }
        />
        {showUpdateBadge && (
          <span
            aria-label="New model version available"
            className="absolute -top-0.5 -right-0.5 rounded-full pointer-events-none"
            style={{
              width: 8,
              height: 8,
              backgroundColor: 'var(--color-warning)',
              border: '1px solid var(--color-surface)',
            }}
          />
        )}
      </div>
    </div>
  );
}
