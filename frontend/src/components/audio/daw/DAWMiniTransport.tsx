'use client';

import { DAW_MINI_TRANSPORT } from '@/utils/constants';
import { DAWTransportBtn, DAWPlayIcon, DAWPauseIcon, DAWStopIcon } from './DAWTransportBtn';

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
}

/**
 * Compact bottom-center transport used when the DAW timeline panel is hidden.
 * Play, pause, and stop use the same 28px buttons and icons as DAWTimeline.
 * A `current / duration` readout (e.g. `0:21/1:00`) sits to the right of the
 * buttons as plain numbers. Showing the timeline replaces this UI.
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: `${DAW_MINI_TRANSPORT.GAP}px`,
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
            fontSize: '10px',
            fontFamily: 'monospace',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--foreground)',
            whiteSpace: 'nowrap',
            background: 'transparent',
            pointerEvents: 'none',
          }}
        >
          {formatTime(currentTime / 1000)}/{formatTime(duration / 1000)}
        </span>
      </div>
    </div>
  );
}
