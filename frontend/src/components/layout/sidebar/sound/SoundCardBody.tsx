'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { TimestampList } from './TimestampList';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER, DEFAULT_DBFS, AUDIO_PLAYBACK } from '@/utils/constants';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * SoundCardBody
 *
 * Shared layout for both pre-generation and post-generation sound cards.
 * Renders:
 *   - Left column:
 *       1. Mode-specific main content (textarea, upload area, waveform, ...)
 *       2. Position (x/y/z) widget — always visible
 *       3. Optional settings summary (post-gen sound cards)
 *   - Right column: interval slider / timestamp list + volume slider
 *
 * All slider state and batched-undo logic live here so it never needs to be
 * duplicated between SoundResultContent and SoundPreContent.
 */

export interface SoundCardBodyProps {
  /** Left slot: WaveSurfer (post-gen) or mode-specific UI (pre-gen) */
  mainContent: ReactNode;
  /** Rendered full-width above the flex row — use for headers that span both columns. */
  fullWidthHeader?: ReactNode;
  /** Rendered in the left column below the position widget (e.g. post-gen settings recap). */
  settingsSummary?: ReactNode;

  // ── Shared data ──────────────────────────────────────────────────────────
  volumeDbfs: number;
  intervalSeconds: number;
  schedulingMode: 'interval' | 'timestamps';
  timestamps: number[];
  position?: [number, number, number];
  /** When defined the sound is entity-linked; position inputs are disabled. */
  entityIndex?: number;

  // ── Mute state ─────────────────────────────────────────────────────────────
  isMuted?: boolean;
  onMuteChange?: (muted: boolean) => void;

  // ── Callbacks ─────────────────────────────────────────────────────────────
  onVolumeChange?: (dbfs: number) => void;
  onIntervalChange?: (sec: number) => void;
  onTimestampsChange?: (ts: number[]) => void;
  onUpdatePosition?: (pos: [number, number, number]) => void;
  onUnlinkEntity?: () => void;

  /** Store ID used for batched-slider undo grouping ('audioControls' | 'soundscape'). */
  storeContext: string;
  /** When true, recolors icons/labels for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

export function SoundCardBody({
  mainContent,
  fullWidthHeader,
  settingsSummary,
  volumeDbfs,
  intervalSeconds,
  schedulingMode,
  timestamps,
  position,
  entityIndex,
  isMuted = false,
  onMuteChange,
  onVolumeChange,
  onIntervalChange,
  onTimestampsChange,
  onUpdatePosition,
  onUnlinkEntity,
  storeContext,
  onBlueBackground = false,
}: SoundCardBodyProps) {
  // Local slider state for smooth visual feedback while dragging
  const [tempVolumeDbfs, setTempVolumeDbfs] = useState(volumeDbfs);
  const [tempIntervalSeconds, setTempIntervalSeconds] = useState(intervalSeconds);

  // Sync with external state (e.g. undo/redo)
  useEffect(() => { setTempVolumeDbfs(volumeDbfs); }, [volumeDbfs]);
  useEffect(() => { setTempIntervalSeconds(intervalSeconds); }, [intervalSeconds]);

  const volumeSlider = useBatchedSlider<number>(
    storeContext,
    (v) => setTempVolumeDbfs(v),
    (v) => {
      onVolumeChange?.(v);
      if (v <= UI_VOLUME_SLIDER.MIN) {
        onMuteChange?.(true);
      } else if (isMuted) {
        onMuteChange?.(false);
      }
    },
  );

  const intervalSlider = useBatchedSlider<number>(
    storeContext,
    (v) => setTempIntervalSeconds(Math.round(v)),
    onIntervalChange ? (v) => onIntervalChange(Math.round(v)) : undefined,
  );

  const isLinked = entityIndex !== undefined;

  return (
    <div>
      {/* Full-width header slot — rendered outside the flex layout */}
      {fullWidthHeader && (
        <div className="mb-2">
          {fullWidthHeader}
        </div>
      )}
      <div className="flex gap-3 min-w-0">
      {/* ── Left column ── */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col gap-1.5">

        {/* 1. Main content — always visible (textarea, upload area, waveform, etc.) */}
        {mainContent}

        {/* 2. Position widget — always visible when provided */}
        {onUpdatePosition && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <PositionWidget
              position={position}
              disabled={isLinked}
              disabledTitle="Position is controlled by the linked entity"
              onUpdatePosition={onUpdatePosition}
              onBlueBackground={onBlueBackground}
            />

            {isLinked && onUnlinkEntity && (
              <button
                onClick={onUnlinkEntity}
                title="Unlink from entity — position will become manually editable"
                className="flex-shrink-0 transition-opacity hover:opacity-70"
                style={{ color: onBlueBackground ? 'var(--color-on-blue)' : 'var(--color-primary)' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7L7 17" />
                </svg>
              </button>
            )}
          </div>
        )}

        {settingsSummary}
      </div>

      {/* ── Right column: vertical sliders ── */}
      <div className="flex gap-2">
        {/* Interval slider (interval mode) */}
        {schedulingMode === 'interval' && onIntervalChange && (
          <VerticalVolumeSlider
            value={tempIntervalSeconds}
            min={UI_INTERVAL_SLIDER.MIN}
            max={UI_INTERVAL_SLIDER.MAX}
            step={1}
            unit="s"
            precision={0}
            defaultValue={AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS}
            label="Int."
            hoverText="Playback interval: Time between sound repetitions in the timeline. Set to 0 for continuous loop. Double-click to reset."
            onDragStart={intervalSlider.onDragStart}
            onChange={intervalSlider.onChange}
            onChangeCommitted={intervalSlider.onCommit}
            onBlueBackground={onBlueBackground}
          />
        )}

        {/* Timestamp list removed — the DAW timeline manages timestamps in timestamp mode */}

        {/* Volume slider */}
        {onVolumeChange && (
          <VerticalVolumeSlider
            value={tempVolumeDbfs}
            min={UI_VOLUME_SLIDER.MIN}
            max={UI_VOLUME_SLIDER.MAX}
            step={1}
            unit="dBFS"
            precision={0}
            defaultValue={DEFAULT_DBFS}
            label="Vol."
            hoverText="Volume level: Controls the level in dBFS for spatial audio playback (0 = full scale). Double-click to reset."
            onDragStart={volumeSlider.onDragStart}
            onChange={volumeSlider.onChange}
            onChangeCommitted={volumeSlider.onCommit}
            onBlueBackground={onBlueBackground}
          />
        )}
      </div>
    </div>
  </div>
  );
}

