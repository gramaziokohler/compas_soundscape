'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { TimestampList } from './TimestampList';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from '@/utils/constants';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * SoundCardBody
 *
 * Shared layout for both pre-generation and post-generation sound cards.
 * Renders:
 *   - Left column: mainContent (WaveSurfer or mode textarea) + position widget + extraContent
 *   - Right column: interval slider / timestamp list + volume slider
 *
 * All slider state and batched-undo logic live here so it never needs to be
 * duplicated between SoundResultContent and SoundPreContent.
 */

export interface SoundCardBodyProps {
  /** Left slot: WaveSurfer (post-gen) or mode-specific UI (pre-gen) */
  mainContent: ReactNode;
  /** Optional content below the position widget (e.g. variant selector buttons) */
  extraContent?: ReactNode;

  // ── Shared data ──────────────────────────────────────────────────────────
  volumeDb: number;
  intervalSeconds: number;
  schedulingMode: 'interval' | 'timestamps';
  timestamps: number[];
  position?: [number, number, number];
  /** When defined the sound is entity-linked; position inputs are disabled. */
  entityIndex?: number;

  // ── Callbacks ─────────────────────────────────────────────────────────────
  onVolumeChange?: (db: number) => void;
  onIntervalChange?: (sec: number) => void;
  onTimestampsChange?: (ts: number[]) => void;
  onUpdatePosition?: (pos: [number, number, number]) => void;
  onUnlinkEntity?: () => void;

  /** Store ID used for batched-slider undo grouping ('audioControls' | 'soundscape'). */
  storeContext: string;
}

export function SoundCardBody({
  mainContent,
  extraContent,
  volumeDb,
  intervalSeconds,
  schedulingMode,
  timestamps,
  position,
  entityIndex,
  onVolumeChange,
  onIntervalChange,
  onTimestampsChange,
  onUpdatePosition,
  onUnlinkEntity,
  storeContext,
}: SoundCardBodyProps) {
  // Local slider state for smooth visual feedback while dragging
  const [tempVolumeDb, setTempVolumeDb] = useState(volumeDb);
  const [tempIntervalSeconds, setTempIntervalSeconds] = useState(intervalSeconds);

  // Sync with external state (e.g. undo/redo)
  useEffect(() => { setTempVolumeDb(volumeDb); }, [volumeDb]);
  useEffect(() => { setTempIntervalSeconds(intervalSeconds); }, [intervalSeconds]);

  const dbToSlider = (db: number) =>
    (db - UI_VOLUME_SLIDER.MIN) / (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN);
  const sliderToDb = (v: number) =>
    UI_VOLUME_SLIDER.MIN + v * (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN);

  const volumeSlider = useBatchedSlider<number>(
    storeContext,
    (v) => setTempVolumeDb(sliderToDb(v)),
    onVolumeChange ? (v) => onVolumeChange(sliderToDb(v)) : undefined,
  );

  const intervalSlider = useBatchedSlider<number>(
    storeContext,
    (v) => setTempIntervalSeconds(Math.round(v * UI_INTERVAL_SLIDER.MAX)),
    onIntervalChange ? (v) => onIntervalChange(Math.round(v * UI_INTERVAL_SLIDER.MAX)) : undefined,
  );

  const isLinked = entityIndex !== undefined;

  return (
    <div className="flex gap-3 min-w-0">
      {/* ── Left column ── */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {mainContent}

        {/* Position widget + extra content */}
        {(onUpdatePosition || extraContent) && (
          <div className="flex flex-col items-start gap-2 mt-1 min-w-0">

            {onUpdatePosition && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isLinked && onUnlinkEntity && (
                  <button
                    onClick={onUnlinkEntity}
                    title="Unlink from entity — position will become manually editable"
                    className="flex-shrink-0 transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {/* Broken-chain icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7L7 17" />
                    </svg>
                  </button>
                )}
                <div
                  className="flex gap-1"
                  title={isLinked ? 'Position is controlled by the linked entity' : undefined}
                >
                  {(['x', 'y', 'z'] as const).map((axis, axisIdx) => {
                    const val = position?.[axisIdx] ?? 0;
                    return (
                      <div key={axis} className="flex flex-col gap-0" style={{ width: '55px', opacity: isLinked ? 0.4 : 1 }}>
                        <span className="text-[9px] font-medium text-secondary-hover uppercase text-center leading-tight">{axis}</span>
                        <input
                          type="number"
                          step="0.1"
                          value={parseFloat(val.toFixed(2))}
                          disabled={isLinked}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            if (isNaN(parsed)) return;
                            const newPos: [number, number, number] = [
                              position?.[0] ?? 0,
                              position?.[1] ?? 0,
                              position?.[2] ?? 0,
                            ];
                            newPos[axisIdx] = parsed;
                            onUpdatePosition(newPos);
                          }}
                          className="w-full text-[9px] text-center rounded px-1 py-0.5 outline-none bg-foreground text-background disabled:cursor-not-allowed"
                          style={{ borderColor: 'var(--card-color, var(--color-primary))55' }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {extraContent}
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

        {/* Timestamp list (timestamps mode) */}
        {schedulingMode === 'timestamps' && onTimestampsChange && (
          <TimestampList timestamps={timestamps} onChange={onTimestampsChange} />
        )}

        {/* Volume slider */}
        {onVolumeChange && (
          <div
            className="flex flex-col items-center"
            title="Volume level: Controls the sound pressure level (SPL) in decibels for spatial audio playback."
          >
            <span className="text-[10px] mb-1 text-secondary-hover">
              {tempVolumeDb.toFixed(0)}dB
            </span>
            <VerticalVolumeSlider
              value={dbToSlider(tempVolumeDb)}
              onDragStart={volumeSlider.onDragStart}
              onChange={volumeSlider.onChange}
              onChangeCommitted={volumeSlider.onCommit}
            />
            <span className="text-[10px] mt-1 text-secondary-hover">Vol.</span>
          </div>
        )}
      </div>
    </div>
  );
}
