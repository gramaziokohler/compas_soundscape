/**
 * Pure snapping math for DAW clip drags — off | fixed grid | smart (ruler tick step),
 * plus magnetism to sibling clip edges and the playhead. Alt bypasses everything.
 */

export type SnapMode = 'off' | 0.1 | 0.5 | 1 | 'smart';

export interface SnapContext {
  mode: SnapMode;
  pxPerSecond: number;
  /** Ruler's current primary tick step (seconds) — used when mode === 'smart'. */
  smartStepSec: number;
  magnetPx: number;
  playheadSec: number;
  /** Other clips' start/end times (seconds) on the same track, excluding the dragged one(s). */
  neighborEdgesSec: number[];
  /** Alt key held — bypass all snapping. */
  bypass: boolean;
}

/** Resolve a raw (pixel-derived) start time in seconds to a snapped start time in seconds. */
export function resolveSnap(rawStartSec: number, ctx: SnapContext): number {
  const raw = Math.max(0, rawStartSec);
  if (ctx.bypass || ctx.mode === 'off') return raw;

  const step = ctx.mode === 'smart' ? Math.max(0.01, ctx.smartStepSec) : ctx.mode;
  const gridSnapped = Math.round(raw / step) * step;

  const magnetSec = ctx.pxPerSecond > 0 ? ctx.magnetPx / ctx.pxPerSecond : 0;
  let best = gridSnapped;
  let bestDist = Math.abs(gridSnapped - raw);

  const candidates = [...ctx.neighborEdgesSec, ctx.playheadSec];
  for (const c of candidates) {
    const d = Math.abs(c - raw);
    if (d <= magnetSec && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }

  return Math.max(0, best);
}
