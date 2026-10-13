/**
 * Pure detection of scheduled content that runs past the DAW timeline end.
 *
 * `extractTimelineSounds` drops every iteration that starts at/after the timeline
 * length, and `DAWClip` cuts the ones that start inside but end after it. So an
 * orchestrated scene baked longer than the (per-scenario) timeline silently loses
 * its tail. This scans the explicit schedules (`soundTimestamps`) — not the visible
 * clips, which have already been filtered — and reports how far the content goes.
 *
 * Auto tracks (no explicit schedule) and background tracks are ignored: their loops
 * are generated to fill the timeline, so their last tile overrunning the end is by
 * design, not lost content.
 */

import { AUDIO_TIMELINE, DAW } from '@/utils/constants';

export interface OverrunTrack {
  /** Explicit clip starts (seconds); `undefined` = auto track. */
  startsSec: number[] | undefined;
  /** Per-iteration clip length (ms) from the bake; 0/missing → `fallbackDurationMs`. */
  iterationDurationsMs?: number[];
  /** Clip length (ms) when no per-iteration length is known. */
  fallbackDurationMs: number;
  /** Solver-excluded iteration indices (never scheduled). */
  excludedIndices?: number[];
  isBackground?: boolean;
}

export interface TimelineOverrun {
  /** Iterations that start after, or end after, the timeline end. */
  iterationCount: number;
  /** Furthest clip end (ms) over every scheduled iteration. */
  contentEndMs: number;
  /** Whole-second duration (ms) that fits every clip. */
  proposedDurationMs: number;
}

export function computeTimelineOverrun(tracks: OverrunTrack[], limitMs: number): TimelineOverrun | null {
  let iterationCount = 0;
  let contentEndMs = 0;
  for (const track of tracks) {
    if (track.isBackground || !track.startsSec?.length) continue;
    track.startsSec.forEach((sec, i) => {
      if (!Number.isFinite(sec) || sec < 0 || sec >= AUDIO_TIMELINE.UNRESOLVED_TIMESTAMP_SEC) return;
      if (track.excludedIndices?.includes(i)) return;
      const iterMs = track.iterationDurationsMs?.[i];
      const durMs = iterMs && iterMs > 0 ? iterMs : track.fallbackDurationMs;
      const endMs = sec * 1000 + durMs;
      contentEndMs = Math.max(contentEndMs, endMs);
      if (endMs > limitMs + DAW.OVERRUN_TOLERANCE_MS) iterationCount += 1;
    });
  }
  if (iterationCount === 0) return null;
  return {
    iterationCount,
    contentEndMs,
    proposedDurationMs: Math.max(limitMs, Math.ceil(contentEndMs / 1000) * 1000),
  };
}
