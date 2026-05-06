'use client';

import React, { useState, useCallback } from 'react';
import { SceneControlButton } from '@/components/ui/SceneControlButton';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { Icon } from '@/components/ui/Icon';
import { UI_SCENE_BUTTON, UI_RIGHT_SIDEBAR } from '@/utils/constants';
import type { SoundEvent } from '@/types';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

interface SceneControlButtonsProps {
  isViewerReady: boolean;
  isRightSidebarExpanded: boolean;
  rightSidebarWidth?: number;
  audioOrchestrator: AudioOrchestrator | null;
  soundscapeData: SoundEvent[] | null;
  speckleData?: { model_id: string; version_id: string; file_id: string; url: string; object_id: string; auth_token?: string } | null;
  isSavingSoundscape: boolean;
  showTimeline: boolean;
  onSaveSoundscape?: () => void;
  onResetZoom: () => void;
  onRefreshScene: () => void;
  onToggleTimeline: () => void;
}

export function SceneControlButtons({
  isViewerReady,
  isRightSidebarExpanded,
  rightSidebarWidth,
  audioOrchestrator,
  soundscapeData,
  speckleData,
  isSavingSoundscape,
  showTimeline,
  onSaveSoundscape,
  onResetZoom,
  onRefreshScene,
  onToggleTimeline,
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
      className="absolute bottom-6 flex flex-col items-center pointer-events-auto z-20 transition-all duration-300"
      style={{
        gap: UI_SCENE_BUTTON.GAP,
        right: isRightSidebarExpanded ? `${(rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) + 20}px` : '20px',
      }}
    >
      {/* Global Volume Control with Hover Slider */}
      <div
        className="flex flex-col items-center"
        onMouseEnter={() => setIsHoveringVolume(true)}
        onMouseLeave={() => setIsHoveringVolume(false)}
      >
        {isHoveringVolume && (
          <div data-volume-slider className="mb-1 flex items-center justify-center">
            <VerticalVolumeSlider value={globalVolume} onChange={handleGlobalVolumeChange} />
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

      {/* Save Soundscape to Speckle */}
      {soundscapeData && soundscapeData.length > 0 && speckleData && onSaveSoundscape && (
        <SceneControlButton
          onClick={onSaveSoundscape}
          isActive={isSavingSoundscape}
          title={isSavingSoundscape ? 'Saving soundscape...' : 'Save soundscape to Speckle'}
          icon={
            isSavingSoundscape ? (
              <Icon>
                <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="0">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 12 12"
                    to="360 12 12"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </circle>
              </Icon>
            ) : (
              <Icon>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </Icon>
            )
          }
        />
      )}

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
      <SceneControlButton
        onClick={onRefreshScene}
        title="Refresh scene"
        icon={
          <Icon>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </Icon>
        }
      />

      {/* Toggle Timeline */}
      <SceneControlButton
        onClick={onToggleTimeline}
        isActive={showTimeline}
        title={showTimeline ? 'Hide timeline' : 'Show timeline'}
        icon={
          <Icon>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <path d="M8 14h.01" />
            <path d="M12 14h.01" />
            <path d="M16 14h.01" />
            <path d="M8 18h.01" />
            <path d="M12 18h.01" />
            <path d="M16 18h.01" />
          </Icon>
        }
      />
    </div>
  );
}
