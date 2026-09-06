/**
 * TimelineScore — declarative, materialized description of everything that should
 * sound during timeline playback.
 *
 * This is the single data structure `Transport` reads. It is rebuilt from store
 * state (`buildScoreFromTimelineSounds`) whenever tracks/clips/durations change,
 * and pushed into the transport with `setScore()` — safe to do at any time,
 * including mid-playback, because the lookahead loop reads the score fresh on
 * every tick.
 *
 * See `Transport.ts` for the scheduling model and the single time invariant
 * everything else derives from.
 */

/** A single scheduled playback event on a track. */
export interface ScoreClip {
  /** Stable identity — survives edits/duplication. Today: `${trackId}-${originalIterationIndex}`. */
  clipId: string;
  /** Absolute timeline position in milliseconds — already resolved, never computed at play time. */
  startMs: number;
  /**
   * Total audible duration in milliseconds for THIS clip, already resolved against
   * whichever variant buffer will actually play (accounts for trim). Pre-computed by
   * `extractTimelineSoundsFromData` (`iterationDurationsMs`) — Transport does not
   * re-derive it, so DAW visuals and audio can never disagree on how long a clip is.
   */
  durationMs: number;
  /**
   * The orchestrator source id to play — already resolved at score-build time
   * from the clip's variant index via explicit prompt_index + copy_index lookup
   * (see `resolveVariantSoundIdByPrompt`), never derived from the id's string
   * shape. This is what makes variant playback correct for copied/duplicated
   * tracks: nothing downstream needs to know or guess the id's shape.
   */
  sourceId: string;
  /**
   * Trim start as a FRACTION (0..1) of the resolved variant's own buffer duration.
   * Stored as a fraction (not seconds) because which buffer is "the" buffer for this
   * clip is only known once the variant is resolved — using the wrong buffer's length
   * to convert a fraction to seconds silently misaligns trims across variants of
   * different lengths.
   */
  trimStartFraction: number;
  /** Fade-in duration in milliseconds (loop-seam smoothing). */
  fadeInMs?: number;
  /** Fade-out duration in milliseconds (loop-seam smoothing). */
  fadeOutMs?: number;
  /** Per-clip entity position override (world space). Absent = use the track's default registered position. */
  position?: [number, number, number];
}

/** One timeline track — one row in the DAW, one primary sound id in the orchestrator. */
export interface ScoreTrack {
  /** Primary sound id for this track (also the orchestrator source id for variant 0). */
  trackId: string;
  clips: ScoreClip[];
}

/** The full declarative score for one timeline. */
export interface TimelineScore {
  /** Total timeline duration in milliseconds — playback stops here. */
  durationMs: number;
  tracks: ScoreTrack[];
}
