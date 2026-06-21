'use client';

import { useCallback, useState } from 'react';
import { DAWIteration } from './DAWIteration';
import type { IterationContextMenuData } from './DAWIteration';
import type { TimelineSound, IterationLink } from '@/types/audio';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { WAVESURFER_TIMELINE } from '@/utils/constants';

const LABEL_WIDTH = 120;

/** Closed-lock SVG (interval mode — position is locked, drag disabled) */
function LockClosedIcon({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Open-lock SVG (timestamps mode — positions are free to drag) */
function LockOpenIcon({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

interface DAWTrackProps {
  sound: TimelineSound;
  pxPerSecond: number;
  timelineDurationMs: number;
  isMuted: boolean;
  isSoloed: boolean;
  onMute: () => void;
  onSolo: () => void;
  onDeleteIteration: (iterationIndex: number) => void;
  onDragEnd: (iterationIndex: number, newStartMs: number) => void;
  onDuplicate: (newStartMs: number) => void;
  onSelectSoundCard?: () => void;
  onDoubleClickSoundCard?: () => void;
  onIterationContextMenu: (data: IterationContextMenuData) => void;
}

export function DAWTrack({
  sound,
  pxPerSecond,
  timelineDurationMs,
  isMuted,
  isSoloed,
  onMute,
  onSolo,
  onDeleteIteration,
  onDragEnd,
  onDuplicate,
  onSelectSoundCard,
  onDoubleClickSoundCard,
  onIterationContextMenu,
}: DAWTrackProps) {
  const soundSchedulingModes = useAudioControlsStore((s) => s.soundSchedulingModes);
  const handleSchedulingModeChange = useAudioControlsStore((s) => s.handleSchedulingModeChange);
  const iterationLinks = useAudioControlsStore((s) => s.iterationLinks);
  const schedulingMode = soundSchedulingModes[sound.id] ?? 'interval';
  const isDraggable = schedulingMode === 'timestamps';



  const trackHeight = WAVESURFER_TIMELINE.TRACK_HEIGHT + WAVESURFER_TIMELINE.TRACK_SPACING;
  const contentWidth = (timelineDurationMs / 1000) * pxPerSecond;

  const handleToggleLock = useCallback(() => {
    const nextMode = schedulingMode === 'interval' ? 'timestamps' : 'interval';
    handleSchedulingModeChange(sound.id, nextMode, sound.soundDurationMs / 1000);
  }, [schedulingMode, handleSchedulingModeChange, sound.id, sound.soundDurationMs]);

  return (
    <div
      style={{
        display: 'flex',
        height: `${trackHeight}px`,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Label gutter — sticky left */}
      <div
        style={{
          width: `${LABEL_WIDTH}px`,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingLeft: '8px',
          paddingRight: '4px',
          backgroundColor: 'var(--background)',
          borderRight: '1px solid rgba(255,255,255,0.1)',
          position: 'sticky',
          left: 0,
          zIndex: 10,
          overflow: 'hidden',
          gap: '2px',
        }}
      >
        {/* Sound name */}
        <span
          title={sound.displayName}
          onClick={onSelectSoundCard}
          onDoubleClick={onDoubleClickSoundCard}
          style={{
            fontSize: '10px',
            color: 'var(--foreground)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: onSelectSoundCard ? 'pointer' : 'default',
            lineHeight: 1.2,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: sound.color,
              marginRight: '4px',
              flexShrink: 0,
              verticalAlign: 'middle',
            }}
          />
          {sound.displayName}
        </span>

        {/* Mute / Solo / Lock row */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <button
            onClick={(e) => { e.stopPropagation(); onMute(); }}
            title={isMuted ? 'Unmute' : 'Mute'}
            style={{
              fontSize: '8px',
              padding: '1px 4px',
              borderRadius: '2px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: isMuted
                ? 'var(--color-warning)'
                : 'var(--color-secondary-light)',
              color: isMuted ? '#000' : 'var(--foreground)',
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            M
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSolo(); }}
            title={isSoloed ? 'Unsolo' : 'Solo'}
            style={{
              fontSize: '8px',
              padding: '1px 4px',
              borderRadius: '2px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: isSoloed
                ? 'var(--color-primary)'
                : 'var(--color-secondary-light)',
              color: isSoloed ? '#fff' : 'var(--foreground)',
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            S
          </button>
          {/* Lock — interval=closed/primary, timestamps=open/dimmed */}
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleLock(); }}
            title={
              schedulingMode === 'interval'
                ? 'Interval mode (positions locked) — click to switch to timestamp mode'
                : 'Timestamp mode (free drag) — click to switch to interval mode'
            }
            style={{
              width: 18,
              height: 18,
              borderRadius: '2px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {schedulingMode === 'interval' ? (
              <LockClosedIcon color="var(--color-primary)" />
            ) : (
              <LockOpenIcon color="var(--color-secondary-hover)" />
            )}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          minWidth: `${contentWidth}px`,
          backgroundColor: isMuted ? 'rgba(30,30,30,0.4)' : 'transparent',
        }}
      >
        {sound.scheduledIterations.map((startMs, i) => {
          // Per-iteration duration: use the variant's actual buffer length when available,
          // falling back to the primary copy's duration (soundDurationMs).
          const iterDurationMs = sound.iterationDurationsMs?.[i] ?? sound.soundDurationMs;

          const siblings = sound.scheduledIterations
            .map((s, idx) => ({
              startMs: s,
              durationMs: sound.iterationDurationsMs?.[idx] ?? sound.soundDurationMs,
              idx,
            }))
            .filter((s) => s.idx !== i)
            .map(({ startMs: sMs, durationMs }) => ({ startMs: sMs, durationMs }));

          // Use the original iteration index (before filtering out unresolved timestamps)
          // so that the correct iterationLink badge is shown even when some earlier iterations
          // were skipped because they were out-of-range or still unresolved.
          const originalIdx = sound.scheduledIterationOriginalIndices?.[i] ?? i;
          const iterationLink: IterationLink | undefined =
            iterationLinks[`${sound.id}-${originalIdx}`];
          const iterAudioUrl = sound.iterationAudioUrls?.[i] ?? sound.audioUrl;

          return (
            <DAWIteration
              key={`${sound.id}-${originalIdx}-${startMs}-${iterAudioUrl ?? 'default'}`}
              soundId={sound.id}
              iterationIndex={originalIdx}
              startMs={startMs}
              durationMs={iterDurationMs}
              pxPerSecond={pxPerSecond}
              audioUrl={iterAudioUrl}
              color={sound.color}
              isMuted={isMuted}
              isDraggable={isDraggable}
              timelineDurationMs={timelineDurationMs}
              siblings={siblings}
              iterationLink={iterationLink}
              onDelete={() => onDeleteIteration(originalIdx)}
              onClick={() => onSelectSoundCard?.()}
              onDoubleClick={onDoubleClickSoundCard}
              onDragEnd={(newStartMs) => onDragEnd(i, newStartMs)}
              onDuplicate={onDuplicate}
              onContextMenu={onIterationContextMenu}
            />
          );
        })}
      </div>
    </div>
  );
}
