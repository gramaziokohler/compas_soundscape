'use client';

import { memo, useMemo } from 'react';
import { DAWClip } from './DAWClip';
import type { IterationLink } from '@/types/audio';

export interface DAWLaneClip {
  clipKey: string;
  iterationIndex: number;
  startMs: number;
  durationMs: number;
  audioUrl?: string;
  label: string;
  iterationLink?: IterationLink;
  /** True for a solver-excluded, display-only ghost clip. */
  excluded?: boolean;
  /** Why the iteration was excluded. */
  reason?: string;
}

interface DAWLaneProps {
  soundId: string;
  color: string;
  clips: DAWLaneClip[];
  pxPerSecond: number;
  trackHeight: number;
  timelineDurationMs: number;
  isMuted: boolean;
  isDraggable: boolean;
  selectedClipKeys: Set<string>;
  /** clipKey -> live drag offset (ms); only present for clips in the active gesture. */
  dragPreview: Record<string, number> | null;
  isDragging: boolean;
  isDuplicating: boolean;
  tickStepPx: number;
  onClipPointerDown: (e: React.PointerEvent<HTMLDivElement>, clip: DAWLaneClip) => void;
  onDeleteClip: (iterationIndex: number) => void;
  onClipContextMenu: (iterationIndex: number, x: number, y: number) => void;
  onClipDoubleClick?: () => void;
  onClipHover?: (iterationIndex: number) => void;
  onClipHoverEnd?: () => void;
}

function overlaps(a: DAWLaneClip, b: DAWLaneClip): boolean {
  return a.startMs < b.startMs + b.durationMs && a.startMs + a.durationMs > b.startMs;
}

function DAWLaneImpl({
  soundId,
  color,
  clips,
  pxPerSecond,
  trackHeight,
  timelineDurationMs,
  isMuted,
  isDraggable,
  selectedClipKeys,
  dragPreview,
  isDragging,
  isDuplicating,
  tickStepPx,
  onClipPointerDown,
  onDeleteClip,
  onClipContextMenu,
  onClipDoubleClick,
  onClipHover,
  onClipHoverEnd,
}: DAWLaneProps) {
  const contentWidth = (timelineDurationMs / 1000) * pxPerSecond;

  const overlapFlags = useMemo(() => {
    const flags = new Map<string, boolean>();
    for (let i = 0; i < clips.length; i++) {
      let ov = false;
      for (let j = 0; j < clips.length; j++) {
        if (i !== j && overlaps(clips[i], clips[j])) { ov = true; break; }
      }
      flags.set(clips[i].clipKey, ov);
    }
    return flags;
  }, [clips]);

  return (
    <div
      data-daw-lane={soundId}
      style={{
        flex: 1,
        position: 'relative',
        minWidth: `${contentWidth}px`,
        height: `${trackHeight}px`,
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: isMuted ? 'color-mix(in srgb, var(--color-secondary-light) 40%, transparent)' : 'transparent',
        backgroundImage: `repeating-linear-gradient(90deg, var(--color-border) 0, var(--color-border) 1px, transparent 1px, transparent ${tickStepPx}px)`,
        backgroundPosition: '0 0',
      }}
    >
      {clips.map((clip) => (
        <DAWClip
          key={clip.clipKey}
          clipKey={clip.clipKey}
          startMs={clip.startMs}
          durationMs={clip.durationMs}
          pxPerSecond={pxPerSecond}
          audioUrl={clip.audioUrl}
          color={color}
          name={clip.label}
          isMuted={isMuted}
          isDraggable={isDraggable && !clip.excluded}
          isSelected={!clip.excluded && selectedClipKeys.has(clip.clipKey)}
          isOverlapping={overlapFlags.get(clip.clipKey) ?? false}
          isDragging={isDragging && dragPreview?.[clip.clipKey] !== undefined}
          isDuplicating={isDuplicating}
          previewOffsetMs={dragPreview?.[clip.clipKey] ?? 0}
          timelineDurationMs={timelineDurationMs}
          iterationLink={clip.iterationLink}
          isExcluded={clip.excluded}
          excludedReason={clip.reason}
          onPointerDownClip={clip.excluded ? () => {} : (e) => onClipPointerDown(e, clip)}
          onDelete={() => onDeleteClip(clip.iterationIndex)}
          onDoubleClick={clip.excluded ? undefined : onClipDoubleClick}
          onContextMenu={clip.excluded ? () => {} : (x, y) => onClipContextMenu(clip.iterationIndex, x, y)}
          onHover={() => onClipHover?.(clip.iterationIndex)}
          onHoverEnd={onClipHoverEnd}
        />
      ))}
    </div>
  );
}

export const DAWLane = memo(DAWLaneImpl);
