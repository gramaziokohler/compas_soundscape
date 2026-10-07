/**
 * Pure math for trimming one DAW clip by dragging its left/right edge.
 *
 * A clip plays the window `[trim.start, trim.end]` (fractions of its variant's
 * full source buffer of `sourceMs`) starting at `startMs` on the timeline. The
 * audio stays anchored in time: dragging the LEFT edge moves the clip start and
 * the trim start together (content does not slide), dragging the RIGHT edge only
 * moves the end. Edges can be dragged back out up to the full source length.
 */

import type { TrimRange } from '@/types/audio';

export type TrimEdge = 'start' | 'end';

export interface TrimEditInput {
  edge: TrimEdge;
  /** Current kept window (fractions 0–1 of the source buffer). */
  trim: TrimRange;
  /** Untrimmed source buffer length (ms). */
  sourceMs: number;
  /** Current clip start on the timeline (ms). */
  startMs: number;
  /** Raw pointer delta converted to time (ms). */
  deltaMs: number;
  /** Shortest allowed clip length (ms). */
  minDurationMs: number;
  /** Snaps a raw edge time (s) to the grid / neighbour edges / playhead. */
  snapSec: (rawSec: number) => number;
}

export interface TrimEditResult {
  trim: TrimRange;
  startMs: number;
  durationMs: number;
}

/** Clamp where the upper bound wins if the bounds cross (source shorter than the minimum). */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(Math.min(v, hi), Math.min(lo, hi));
}

/** Drop float noise so stored fractions stay stable across save/load. */
function roundFrac(f: number): number {
  return Math.round(Math.min(1, Math.max(0, f)) * 1e6) / 1e6;
}

export function computeTrimEdit({
  edge, trim, sourceMs, startMs, deltaMs, minDurationMs, snapSec,
}: TrimEditInput): TrimEditResult {
  const endMs = startMs + (trim.end - trim.start) * sourceMs;

  if (edge === 'end') {
    const snappedEndMs = snapSec((endMs + deltaMs) / 1000) * 1000;
    const maxEndMs = startMs + (1 - trim.start) * sourceMs;
    const newEndMs = clamp(snappedEndMs, startMs + minDurationMs, maxEndMs);
    return {
      trim: { start: trim.start, end: roundFrac(trim.start + (newEndMs - startMs) / sourceMs) },
      startMs,
      durationMs: newEndMs - startMs,
    };
  }

  const snappedStartMs = snapSec((startMs + deltaMs) / 1000) * 1000;
  // Can't reveal audio before the buffer's first sample, nor start before t=0.
  const minStartMs = Math.max(0, startMs - trim.start * sourceMs);
  const newStartMs = clamp(snappedStartMs, minStartMs, endMs - minDurationMs);
  return {
    trim: { start: roundFrac(trim.start + (newStartMs - startMs) / sourceMs), end: trim.end },
    startMs: newStartMs,
    durationMs: endMs - newStartMs,
  };
}

/**
 * Clip start after dropping a clip trim override in favour of `fallback` (the
 * card trim, or untrimmed): keeps the audio anchored in time, like a left-edge drag.
 */
export function startMsAfterTrimReset(
  startMs: number,
  clipTrim: TrimRange,
  fallback: TrimRange | undefined,
  sourceMs: number,
): number {
  return Math.max(0, startMs + ((fallback?.start ?? 0) - clipTrim.start) * sourceMs);
}
