'use client';

import { useState } from 'react';
import { DAW_CLIP_TRIM } from '@/utils/constants';
import type { TrimEdge } from './daw-trim';

/** Grab zone on one clip edge; drag it to trim that side of the clip. */
export function DAWClipTrimHandle({
  edge,
  visible,
  active,
  onPointerDown,
}: {
  edge: TrimEdge;
  /** Show the edge bar (clip hovered / selected / being trimmed). */
  visible: boolean;
  /** This edge is being dragged or hovered — full-strength bar. */
  active: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const strong = active || hovered;
  return (
    <div
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={edge === 'start' ? 'Drag to trim the start of this clip' : 'Drag to trim the end of this clip'}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [edge === 'start' ? 'left' : 'right']: 0,
        width: DAW_CLIP_TRIM.HANDLE_WIDTH_PX,
        cursor: 'ew-resize',
        zIndex: 25,
        display: 'flex',
        justifyContent: edge === 'start' ? 'flex-start' : 'flex-end',
      }}
    >
      {(visible || hovered) && (
        <div
          style={{
            width: DAW_CLIP_TRIM.HANDLE_BAR_PX,
            height: '100%',
            backgroundColor: 'var(--color-primary)',
            opacity: strong ? 1 : 0.45,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
