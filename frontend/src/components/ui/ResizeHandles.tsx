'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ResizeEdges } from '@/hooks/useFloatingWindow';
import { FLOATING_WINDOW } from '@/utils/constants';

interface ResizeHandlesProps {
  /** From `useFloatingWindow().startResize`. */
  onStart: (edges: ResizeEdges) => (e: ReactPointerEvent) => void;
}

const S = FLOATING_WINDOW.HANDLE_SIZE;

const GRIPS: Array<{ edges: ResizeEdges; cursor: string; style: CSSProperties }> = [
  { edges: { n: true }, cursor: 'ns-resize', style: { top: 0, left: S, right: S, height: S } },
  { edges: { s: true }, cursor: 'ns-resize', style: { bottom: 0, left: S, right: S, height: S } },
  { edges: { w: true }, cursor: 'ew-resize', style: { left: 0, top: S, bottom: S, width: S } },
  { edges: { e: true }, cursor: 'ew-resize', style: { right: 0, top: S, bottom: S, width: S } },
  { edges: { n: true, w: true }, cursor: 'nwse-resize', style: { top: 0, left: 0, width: S * 2, height: S * 2 } },
  { edges: { n: true, e: true }, cursor: 'nesw-resize', style: { top: 0, right: 0, width: S * 2, height: S * 2 } },
  { edges: { s: true, w: true }, cursor: 'nesw-resize', style: { bottom: 0, left: 0, width: S * 2, height: S * 2 } },
  { edges: { s: true, e: true }, cursor: 'nwse-resize', style: { bottom: 0, right: 0, width: S * 2, height: S * 2 } },
];

/**
 * Invisible edge + corner grips for a positioned floating window.
 *
 * Usage: render inside a `position: fixed/relative` container.
 * ```tsx
 * <ResizeHandles onStart={startResize} />
 * ```
 */
export function ResizeHandles({ onStart }: ResizeHandlesProps) {
  return (
    <>
      {GRIPS.map((g, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute z-10 touch-none"
          style={{ ...g.style, cursor: g.cursor }}
          onPointerDown={onStart(g.edges)}
        />
      ))}
    </>
  );
}
