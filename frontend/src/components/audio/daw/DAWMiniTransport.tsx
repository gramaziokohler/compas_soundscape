'use client';

import { DAW_MINI_TRANSPORT } from '@/utils/constants';
import { DAWTransportBtn, DAWPlayIcon, DAWPauseIcon, DAWStopIcon, DAWExpandIcon } from './DAWTransportBtn';

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface DAWMiniTransportProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  /** Expands the compact transport into the full DAW timeline (same effect as "Show timeline"). */
  onExpand: () => void;
}

/**
 * Compact bottom-center transport used when the DAW timeline panel is hidden.
 * Play, pause, and stop use the same 28px buttons and icons as DAWTimeline.
 * A `current / duration` readout (e.g. `0:21/1:00`) sits in its own chip to the
 * right of the buttons, followed by an expand button that reveals the full
 * timeline. The container chrome mirrors the top-center SceneViewModeToolbar so
 * the two read as one system and stay horizontally aligned on the same axis.
 *
 * Usage:
 * ```tsx
 * <DAWMiniTransport
 *   currentTime={playbackState.currentTime}
 *   duration={playbackState.duration}
 *   isPlaying={playbackState.isPlaying}
 *   onPlay={handlePlayAll}
 *   onPause={handlePauseAll}
 *   onStop={handleStopAll}
 *   onExpand={handleToggleTimeline}
 * />
 * ```
 */
export function DAWMiniTransport({
  currentTime,
  duration,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onExpand,
}: DAWMiniTransportProps) {
  return (
    <div
      className="pointer-events-auto"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: `${DAW_MINI_TRANSPORT.BOTTOM}px`,
        transform: 'translateX(-50%)',
        zIndex: DAW_MINI_TRANSPORT.Z_INDEX,
      }}
    >
      <div
        className="flex items-center frosted-surface backdrop-blur-lg backdrop-saturate-150"
        style={{
          gap: `${DAW_MINI_TRANSPORT.GAP}px`,
          padding: `${DAW_MINI_TRANSPORT.PADDING}px`,
          borderRadius: `${DAW_MINI_TRANSPORT.BORDER_RADIUS}px`,
          border: '1px solid var(--color-secondary-light)',
        }}
      >
        {isPlaying ? (
          <DAWTransportBtn onClick={onPause} title="Pause" active>
            <DAWPauseIcon />
          </DAWTransportBtn>
        ) : (
          <DAWTransportBtn onClick={onPlay} title="Play" active>
            <DAWPlayIcon />
          </DAWTransportBtn>
        )}

        <DAWTransportBtn onClick={onStop} title="Stop">
          <DAWStopIcon />
        </DAWTransportBtn>

        <span
          aria-live="polite"
          style={{
            fontSize: `${DAW_MINI_TRANSPORT.TIME_FONT_SIZE}px`,
            fontFamily: 'monospace',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--foreground)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            padding: `${DAW_MINI_TRANSPORT.TIME_PADDING_Y}px ${DAW_MINI_TRANSPORT.TIME_PADDING_X}px`,
            borderRadius: `${DAW_MINI_TRANSPORT.TIME_BORDER_RADIUS}px`,
            backgroundColor: 'var(--color-secondary-lighter)',
            border: '1px solid var(--color-border)',
          }}
        >
          {formatTime(currentTime / 1000)}/{formatTime(duration / 1000)}
        </span>

        <DAWTransportBtn onClick={onExpand} title="Show timeline">
          <DAWExpandIcon />
        </DAWTransportBtn>
      </div>
    </div>
  );
}
