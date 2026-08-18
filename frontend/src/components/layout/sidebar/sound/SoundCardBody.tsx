'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { TimestampList } from './TimestampList';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from '@/utils/constants';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * SoundCardBody
 *
 * Shared layout for both pre-generation and post-generation sound cards.
 * Renders:
 *   - Left column:
 *       1. Position (x/y/z) widget — always visible
 *       2. Mode-specific main content (textarea, upload area, waveform, ...)
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
}

export function SoundCardBody({
  mainContent,
  fullWidthHeader,
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
}: SoundCardBodyProps) {
  // Local slider state for smooth visual feedback while dragging
  const [tempVolumeDbfs, setTempVolumeDbfs] = useState(volumeDbfs);
  const [tempIntervalSeconds, setTempIntervalSeconds] = useState(intervalSeconds);

  // Sync with external state (e.g. undo/redo)
  useEffect(() => { setTempVolumeDbfs(volumeDbfs); }, [volumeDbfs]);
  useEffect(() => { setTempIntervalSeconds(intervalSeconds); }, [intervalSeconds]);

  const dbfsToSlider = (dbfs: number) =>
    (dbfs - UI_VOLUME_SLIDER.MIN) / (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN);
  const sliderToDbfs = (v: number) =>
    UI_VOLUME_SLIDER.MIN + v * (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN);

  const volumeSlider = useBatchedSlider<number>(
    storeContext,
    (v) => setTempVolumeDbfs(sliderToDbfs(v)),
    (v) => {
      const dbfs = sliderToDbfs(v);
      onVolumeChange?.(dbfs);
      if (dbfs <= UI_VOLUME_SLIDER.MIN) {
        onMuteChange?.(true);
      } else if (isMuted) {
        onMuteChange?.(false);
      }
    },
  );

  const intervalSlider = useBatchedSlider<number>(
    storeContext,
    (v) => setTempIntervalSeconds(Math.round(v * UI_INTERVAL_SLIDER.MAX)),
    onIntervalChange ? (v) => onIntervalChange(Math.round(v * UI_INTERVAL_SLIDER.MAX)) : undefined,
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
            />

            {isLinked && onUnlinkEntity && (
              <button
                onClick={onUnlinkEntity}
                title="Unlink from entity — position will become manually editable"
                className="flex-shrink-0 transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7L7 17" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Right column: vertical sliders ── */}
      <div className="flex gap-2">
        {/* Interval slider (interval mode) */}
        {schedulingMode === 'interval' && onIntervalChange && (
          <div
            className="flex flex-col items-center"
            title="Playback interval: Time between sound repetitions in the timeline. Set to 0 for continuous loop."
          >
            <span className="text-[10px] mb-1 text-secondary-hover">
              {tempIntervalSeconds === 0 ? '∞' : `${tempIntervalSeconds}s`}
            </span>
            <VerticalVolumeSlider
              value={tempIntervalSeconds / UI_INTERVAL_SLIDER.MAX}
              onDragStart={intervalSlider.onDragStart}
              onChange={intervalSlider.onChange}
              onChangeCommitted={intervalSlider.onCommit}
            />
            <span className="text-[10px] mt-1 text-secondary-hover">Int.</span>
          </div>
        )}

        {/* Timestamp list removed — the DAW timeline manages timestamps in timestamp mode */}

        {/* Volume slider */}
        {onVolumeChange && (
          <div
            className="flex flex-col items-center"
            title="Volume level: Controls the level in dBFS for spatial audio playback (0 = full scale)."
          >
            <span className="text-[10px] mb-1 text-secondary-hover">
              {isMuted || tempVolumeDbfs <= UI_VOLUME_SLIDER.MIN ? 'Mute' : `${tempVolumeDbfs.toFixed(0)}dBFS`}
            </span>
            <VerticalVolumeSlider
              value={dbfsToSlider(tempVolumeDbfs)}
              onDragStart={volumeSlider.onDragStart}
              onChange={volumeSlider.onChange}
              onChangeCommitted={volumeSlider.onCommit}
            />
            <span className="text-[10px] mt-1 text-secondary-hover">Vol.</span>
          </div>
        )}
      </div>
    </div>
  </div>
  );
}

