'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { UI_VOLUME_SLIDER, DEFAULT_DBFS } from '@/utils/constants';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * SoundCardBody
 *
 * Shared layout for both pre-generation and post-generation sound cards.
 * Renders:
 *   - Left column:
 *       1. Mode-specific main content (textarea, upload area, waveform, ...)
 *       2. Position (x/y/z) widget — always visible
 *       3. Left-column footer (e.g. the Interval mode group via `leftColumnFooter`)
 *   - Right column: volume slider
 *
 * The interval control lives in `IntervalModeControls` (post-gen, interval
 * mode only) and is slotted into the left column through `leftColumnFooter`;
 * the vertical "Int." slider was removed.
 *
 * All slider state and batched-undo logic live here so it never needs to be
 * duplicated between SoundResultContent and SoundPreContent.
 */

export interface SoundCardBodyProps {
  /** Left slot: WaveSurfer (post-gen) or mode-specific UI (pre-gen) */
  mainContent: ReactNode;
  /** Rendered full-width above the flex row — use for headers that span both columns. */
  fullWidthHeader?: ReactNode;
  /** Extra content rendered at the bottom of the LEFT column (e.g. the Interval-mode group). */
  leftColumnFooter?: ReactNode;

  // ── Shared data ──────────────────────────────────────────────────────────
  volumeDbfs: number;
  position?: [number, number, number];
  /** When defined the sound is entity-linked; position inputs are disabled. */
  entityIndex?: number;

  // ── Mute state ─────────────────────────────────────────────────────────────
  isMuted?: boolean;
  onMuteChange?: (muted: boolean) => void;

  // ── Callbacks ─────────────────────────────────────────────────────────────
  onVolumeChange?: (dbfs: number) => void;
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
  leftColumnFooter,
  volumeDbfs,
  position,
  entityIndex,
  isMuted = false,
  onMuteChange,
  onVolumeChange,
  onUpdatePosition,
  onUnlinkEntity,
  storeContext,
  onBlueBackground = false,
}: SoundCardBodyProps) {
  // Local slider state for smooth visual feedback while dragging
  const [tempVolumeDbfs, setTempVolumeDbfs] = useState(volumeDbfs);

  // Sync with external state (e.g. undo/redo)
  useEffect(() => { setTempVolumeDbfs(volumeDbfs); }, [volumeDbfs]);

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

          </div>
        )}

        {/* 3. Left-column footer (e.g. Interval mode group) — left of the volume slider */}
        {leftColumnFooter}
      </div>

      {/* ── Right column: volume slider ── */}
      {onVolumeChange && (
        <div className="flex gap-2 items-stretch">
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
            fillHeight
          />
        </div>
      )}
    </div>
  </div>
  );
}
