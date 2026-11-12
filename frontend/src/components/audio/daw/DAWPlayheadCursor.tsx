'use client';

import { useTransportTimeStore } from '@/store';
import { DAW } from '@/utils/constants';

interface DAWPlayheadCursorProps {
  pxPerSecond: number;
}

/**
 * The DAW playback cursor. The only timeline element that subscribes to the
 * live playhead every frame, so playback re-renders this line rather than the
 * whole dock / scene. Offset by HEAD_WIDTH like the ruler, so it never renders
 * under the sticky head column.
 */
export function DAWPlayheadCursor({ pxPerSecond }: DAWPlayheadCursorProps) {
  const currentTimeMs = useTransportTimeStore((s) => s.currentTimeMs);
  const left = DAW.HEAD_WIDTH + (currentTimeMs / 1000) * pxPerSecond;
  return (
    <div
      style={{
        position: 'absolute', top: 0, left: `${left}px`, width: '2px', bottom: 0,
        backgroundColor: 'var(--color-primary)', opacity: 0.85, zIndex: 50, pointerEvents: 'none',
        boxShadow: '0 0 4px var(--color-primary)',
      }}
    />
  );
}
