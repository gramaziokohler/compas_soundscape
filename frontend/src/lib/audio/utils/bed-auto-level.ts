/**
 * Background-bed auto level
 *
 * Every sound file is loudness-calibrated to one anchor, and each sound's dB level
 * is an offset from it. A bed plays continuously and (as a global source) with no
 * distance falloff, while events are sparse and lose level with distance. So the
 * bed level is derived from the scene itself, as a last step:
 *
 *   level_i at listener = level_i − 20·log10(max(ref, distance_i))
 *   share_i             = fraction of the scene the event is playing
 *   L_events            = 10·log10( Σ share_i · 10^(level_i at listener / 10) )
 *   bed (at listener)   = L_events − MARGIN_DB, clamped to the bed band
 *
 * A non-global bed is a point source too, so its distance loss is added back.
 * Pure functions only: the store gathers the inputs (soundscapeStore
 * `applyBackgroundAutoLevels`).
 */

import { BACKGROUND_AUTO_LEVEL } from '@/utils/constants';

type Vec3 = readonly [number, number, number];

/** One foreground event track (one per prompt / speech line, not per variant). */
export interface AutoLevelEvent {
  /** Level of the track (dB offset scale, same as volume_dbfs). */
  levelDb: number;
  /** Distance to the listener in metres, or null when unknown (fallback distance). */
  distanceM: number | null;
  /** Seconds the track is audible within the scene (sum over its iterations). */
  activeSec: number;
}

export interface AutoLevelBed {
  /** Global bed (no distance falloff) or a positioned bed. */
  isGlobal: boolean;
  /** Distance to the listener (positioned beds), null when unknown. */
  distanceM: number | null;
}

/** dB lost to distance for a point source (1/r beyond the reference distance). */
export function distanceLossDb(distanceM: number | null): number {
  const d = distanceM ?? BACKGROUND_AUTO_LEVEL.FALLBACK_LISTENER_DISTANCE_M;
  return 20 * Math.log10(Math.max(BACKGROUND_AUTO_LEVEL.REFERENCE_DISTANCE_M, d));
}

/**
 * Time-averaged level of the events at the listener (energy sum weighted by the
 * share of the scene each one plays). Null when nothing plays.
 */
export function eventsAverageLevelDb(events: ReadonlyArray<AutoLevelEvent>, sceneSec: number): number | null {
  if (sceneSec <= 0) return null;
  let energy = 0;
  for (const e of events) {
    const share = Math.min(1, Math.max(0, e.activeSec / sceneSec));
    if (share <= 0) continue;
    energy += share * 10 ** ((e.levelDb - distanceLossDb(e.distanceM)) / 10);
  }
  return energy > 0 ? 10 * Math.log10(energy) : null;
}

/** Level to give a bed so it sits MARGIN_DB under the events, within the bed band. */
export function bedAutoLevelDb(events: ReadonlyArray<AutoLevelEvent>, sceneSec: number, bed: AutoLevelBed): number {
  const avg = eventsAverageLevelDb(events, sceneSec);
  if (avg === null) return BACKGROUND_AUTO_LEVEL.DEFAULT_DBFS;
  const atListener = avg - BACKGROUND_AUTO_LEVEL.MARGIN_DB;
  const level = bed.isGlobal ? atListener : atListener + distanceLossDb(bed.distanceM);
  const clamped = Math.max(BACKGROUND_AUTO_LEVEL.MIN_DBFS, Math.min(BACKGROUND_AUTO_LEVEL.MAX_DBFS, level));
  return Math.round(clamped * 10) / 10;
}

/**
 * Seconds a track plays inside [0, sceneSec): explicit start times with their
 * durations (clipped to the scene), or — for an auto track — the loop the timeline
 * derives from its interval (gap after each play; 0 = back to back).
 */
export function activeSeconds(
  sceneSec: number,
  durationSec: number,
  startsSec: ReadonlyArray<number> | undefined,
  iterationDurationsSec: ReadonlyArray<number> | undefined,
  intervalSec: number,
): number {
  if (sceneSec <= 0 || durationSec <= 0) return 0;
  if (startsSec?.length) {
    let total = 0;
    startsSec.forEach((start, i) => {
      if (start >= sceneSec || start < 0) return;
      const dur = iterationDurationsSec?.[i] && iterationDurationsSec[i] > 0 ? iterationDurationsSec[i] : durationSec;
      total += Math.min(dur, sceneSec - start);
    });
    return Math.min(total, sceneSec);
  }
  return sceneSec * (durationSec / (durationSec + Math.max(0, intervalSec)));
}

/** Euclidean distance, or null when either point is missing. */
export function distanceBetween(a: Vec3 | null | undefined, b: Vec3 | null | undefined): number | null {
  if (!a || !b || a.length < 3 || b.length < 3) return null;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
