'use client';

import { BarButton } from '@/components/ui/BarButton';
import { Icon, RefreshIcon } from '@/components/ui/Icon';
import { NotificationCenter } from '@/components/ui/NotificationCenter';
import { UndoRedoToolbar } from '@/components/ui/UndoRedoToolbar';
import { SceneShortcutsButton } from '@/components/scene/SceneShortcutsButton';
import { SceneVolumeButton } from '@/components/scene/SceneVolumeButton';
import { useSceneWorkflowStore, useUIStore } from '@/store';
import { SCENE_BOTTOM_BAR } from '@/utils/constants';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

function formatTime(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ICON = SCENE_BOTTOM_BAR.ICON_SIZE;

export interface SceneBottomBarProps {
  isViewerReady: boolean;
  isSandbox: boolean;
  isFirstPersonMode: boolean;

  // History / persistence
  enableAutoSave: boolean;
  isSavingSoundscape: boolean;
  onSaveSoundscape?: () => void;

  // Playback (center)
  hasTimeline: boolean;
  isPlaying: boolean;
  currentTimeMs: number;
  durationMs: number;
  showTimeline: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onToggleTimeline: () => void;

  // View tools
  audioOrchestrator: AudioOrchestrator | null;
  onResetZoom: () => void;
  onRefreshScene: () => void;
  showUpdateBadge: boolean;
  showObjectExplorer: boolean;
  onToggleExplorer: () => void;
  showLoadModelPanel: boolean;
  onToggleLoadModel: () => void;

  // System
  showAdvancedSettings: boolean;
  onToggleSettings: () => void;
}

/**
 * SceneBottomBar Component
 *
 * Full-width frosted control strip docked to the bottom edge. Groups every
 * scene-level control by intent:
 *   left   — app: home, "Simple" (Expert mode only — the full Simple/Expert
 *            choice lives in Settings › Display), undo/redo, save
 *   center — playback of the selected scene: play/pause, stop, time, timeline
 *   right  — view: volume, reset view, refresh, Object Explorer / load model;
 *            then help & system: shortcuts, notifications, settings
 * The docked DAW opens above it; sidebars stop at its top edge.
 *
 * Usage:
 * ```tsx
 * <SceneBottomBar isViewerReady={ready} ... />
 * ```
 */
export function SceneBottomBar(props: SceneBottomBarProps) {
  const {
    isViewerReady, isSandbox, isFirstPersonMode,
    enableAutoSave, isSavingSoundscape, onSaveSoundscape,
    hasTimeline, isPlaying, currentTimeMs, durationMs, showTimeline,
    onPlay, onPause, onStop, onToggleTimeline,
    audioOrchestrator, onResetZoom, onRefreshScene, showUpdateBadge,
    showObjectExplorer, onToggleExplorer, showLoadModelPanel, onToggleLoadModel,
    showAdvancedSettings, onToggleSettings,
  } = props;
  const isExpert = useUIStore((s) => s.uiMode === 'expert');
  const switchUIMode = useSceneWorkflowStore((s) => s.switchUIMode);

  return (
    <div
      className="scene-bottom-bar backdrop-blur-lg backdrop-saturate-150 pointer-events-auto"
      style={{ zIndex: SCENE_BOTTOM_BAR.Z_INDEX, display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}
      role="toolbar"
      aria-label="Scene controls"
    >
      {/* ── Left: app, mode, history ── */}
      <div className="scene-bottom-bar__group" style={{ justifySelf: 'start' }}>
        <button
          type="button"
          className="scene-bottom-bar__brand"
          onClick={() => { window.location.href = window.location.origin; }}
          title="Home"
        >
          Sound is blue
        </button>
        {isExpert && (
          <BarButton
            onClick={() => switchUIMode('simple')}
            title="Back to Simple mode"
            label="Simple"
            icon={
              <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="3" />
                <circle cx="7" cy="17" r="3" />
                <circle cx="17" cy="12" r="3" />
              </svg>
            }
          />
        )}
        <div className="scene-bottom-bar__sep" />
        <UndoRedoToolbar />
        {isViewerReady && onSaveSoundscape && !enableAutoSave && (
          <BarButton
            onClick={onSaveSoundscape}
            active={isSavingSoundscape}
            title={isSavingSoundscape ? 'Saving…' : 'Save progress'}
            label={isSavingSoundscape ? 'Saving…' : 'Save'}
            icon={
              <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            }
          />
        )}
      </div>

      {/* ── Center: playback ── */}
      <div className="scene-bottom-bar__group">
        {isViewerReady && hasTimeline && (
          <>
            <button
              type="button"
              className="bar-play"
              onClick={isPlaying ? onPause : onPlay}
              title={isPlaying ? 'Pause' : 'Play the scene'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                </svg>
              )}
            </button>
            <BarButton
              onClick={onStop}
              title="Stop"
              icon={
                <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
              }
            />
            <span className="bar-time" aria-live="polite">
              {formatTime(currentTimeMs)} / {formatTime(durationMs)}
            </span>
            <BarButton
              onClick={onToggleTimeline}
              active={showTimeline}
              title={showTimeline ? 'Hide timeline' : 'Show timeline'}
              label="Timeline"
              icon={
                <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 6h10M7 12h14M3 18h8" />
                </svg>
              }
            />
          </>
        )}
      </div>

      {/* ── Right: view tools, then help & system ── */}
      <div className="scene-bottom-bar__group" style={{ justifySelf: 'end' }}>
        {isViewerReady && (
          <>
            <SceneVolumeButton audioOrchestrator={audioOrchestrator} />
            <BarButton
              onClick={onResetZoom}
              title="Reset camera view"
              icon={
                <Icon>
                  <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                  <circle cx="12" cy="12" r="3" />
                </Icon>
              }
            />
            <BarButton
              onClick={onRefreshScene}
              title={showUpdateBadge ? 'New model version available — refresh scene' : 'Refresh scene'}
              warning={showUpdateBadge}
              dot={showUpdateBadge}
              icon={<RefreshIcon size="0.8rem" />}
            />
            {isSandbox ? (
              <BarButton
                id="load-speckle-model-button"
                onClick={onToggleLoadModel}
                active={showLoadModelPanel}
                title="Load a Speckle model"
                label="Load model"
                icon={
                  <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                }
              />
            ) : (
              <BarButton
                onClick={onToggleExplorer}
                active={showObjectExplorer}
                title={showObjectExplorer ? 'Close Object Explorer' : 'Open Object Explorer — model layers and objects'}
                icon={
                  <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 5h8M7 5v14h4M7 12h4" />
                    <rect x="13" y="3" width="8" height="4" rx="1" />
                    <rect x="13" y="10" width="8" height="4" rx="1" />
                    <rect x="13" y="17" width="8" height="4" rx="1" />
                  </svg>
                }
              />
            )}
            <div className="scene-bottom-bar__sep" />
          </>
        )}
        <SceneShortcutsButton isFirstPersonMode={isFirstPersonMode} />
        <NotificationCenter />
        <BarButton
          onClick={onToggleSettings}
          active={showAdvancedSettings}
          title={showAdvancedSettings ? 'Close settings' : 'Settings'}
          icon={
            <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
