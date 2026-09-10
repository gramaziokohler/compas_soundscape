/**
 * Timeline Utilities
 *
 * Helper functions for extracting and formatting scheduled sound data
 * for the AudioTimeline component.
 */

import { AUDIO_TIMELINE } from '@/utils/constants';
import type { TimelineSound, SoundMetadata, IterationLink } from '@/types/audio';
import type { SoundEvent } from '@/types';
import { resolveVariantSoundIdByPrompt } from '@/lib/audio/utils/variant-sound-id';

/** Per-iteration audio URL + duration derived from the assigned variant's loaded buffer. */
function getIterationVariantInfo(
  primarySoundId: string,
  iterationIndex: number,
  soundMetadata: Map<string, SoundMetadata>,
  primaryMetadata: SoundMetadata,
  iterationLinks: Record<string, IterationLink> | undefined,
  soundTrims: Record<string, { start: number; end: number }> | undefined,
  fallbackDurationMs: number,
  soundEvents?: SoundEvent[],
): { audioUrl: string; durationMs: number } {
  const link = iterationLinks?.[`${primarySoundId}-${iterationIndex}`];
  const variantIdx = link?.variantIndex ?? 0;
  // Resolve by explicit prompt_index + copy_index grouping (works for every id
  // shape, including duplicated/AI-detected tracks) — not by parsing the id.
  const variantId = resolveVariantSoundIdByPrompt(
    primarySoundId,
    variantIdx,
    primaryMetadata.soundEvent.prompt_index,
    soundEvents ?? [],
  );
  const variantMeta = soundMetadata.get(variantId);
  if (link?.variantIndex !== undefined) {
    console.log(`[DEBUG-TIMELINE-VARIANT] iterLink[${primarySoundId}-${iterationIndex}] variantIdx=${link.variantIndex} variantId=${variantId} metaFound=${variantMeta !== undefined} variantHasBuffer=${!!variantMeta?.buffer}`);
  }
  const eventOverride = soundEvents?.find((e) => e.id === variantId);

  const trim = soundTrims?.[primarySoundId];
  let durationMs = fallbackDurationMs;
  if (variantMeta?.buffer) {
    const bufMs = variantMeta.buffer.duration * 1000;
    durationMs = trim ? bufMs * (trim.end - trim.start) : bufMs;
  }

  const audioUrl =
    eventOverride?.url ??
    variantMeta?.soundEvent.url ??
    primaryMetadata.soundEvent.url;
  return { audioUrl, durationMs };
}

/**
 * Compute a deterministic stagger delay for a sound based on its ID.
 * Using a hash instead of Math.random() ensures the delay is stable across renders,
 * so the timeline can show the correct offset before playback starts.
 */
export function computeInitialDelay(soundId: string, maxDelayMs: number): number {
  if (maxDelayMs <= 0) return 0;
  // djb2-style hash → deterministic, sound-specific offset in [0, maxDelayMs)
  let hash = 5381;
  for (let i = 0; i < soundId.length; i++) {
    hash = ((hash << 5) + hash) ^ soundId.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash % Math.round(maxDelayMs);
}

/**
 * Finalize a 32-bit integer hash so a 1-bit difference in any input bit
 * (e.g. consecutive iteration indices, which differ only in low bits) is
 * diffused across all 32 bits. Without an avalanche, djb2's trailing ASCII
 * digit only toggles the low bits of the final value, so consecutive indices
 * hash to near-identical offsets and the "random" gaps collapse into fixed,
 * block-wise spacing (first N iterations all share one gap, next block another).
 */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Compute a deterministic jitter offset for a sound's specific iteration.
 * Uses sound ID + iteration index to ensure the offset is stable across renders,
 * preventing timeline refreshes when metadata updates trigger re-extraction.
 *
 * The hash is run through an fmix32 avalanche so consecutive iteration indices
 * produce well-distributed, independent-looking offsets in [-maxJitterMs, maxJitterMs]
 * rather than the blocky values raw djb2 yields for incrementing indices.
 *
 * @param soundId - Unique sound identifier
 * @param iterationIndex - Zero-based iteration number (0, 1, 2, ...)
 * @param maxJitterMs - Maximum jitter magnitude in milliseconds
 * @returns Jitter offset in range [-maxJitterMs, maxJitterMs]
 */
export function computeIterationJitter(soundId: string, iterationIndex: number, maxJitterMs: number): number {
  if (maxJitterMs <= 0) return 0;

  // Combine soundId and iterationIndex for unique per-iteration hash
  const combined = `${soundId}#${iterationIndex}`;
  let hash = 5381;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) + hash) ^ combined.charCodeAt(i);
    hash = hash >>> 0;
  }

  // Avalanche: diffuse the low-bit differences of incrementing indices.
  hash = fmix32(hash);

  // Map hash to range [0, 1]
  const normalized = hash / 0x100000000;
  // Map to [-1, 1] then multiply by maxJitterMs
  return (normalized * 2 - 1) * maxJitterMs;
}

export interface GenerateLoopTimestampsArgs {
  /** Seed id so deterministic jitter offsets are stable per track. */
  soundId: string;
  /**
   * Seconds of each consecutive iteration, used to advance to the next start
   * (start_{i+1} = start_i + dur_i + gap_i). Falls back to the last entry then to
   * `fallbackDurationSec`. Absent/empty ⇒ every iteration uses `fallbackDurationSec`.
   */
  durationSecPerIteration?: number[];
  /** Duration to use when no per-iteration durations are provided. */
  fallbackDurationSec: number;
  /** Base gap (seconds) between the end of one clip and the start of the next. 0 = back-to-back. */
  intervalSec: number;
  /** Max deterministic per-iteration offset (seconds) applied to each gap (humanizing variability). */
  jitterSec: number;
  /** Timeline length (seconds). Iterations are generated from t=0 until this is reached. */
  timelineSec: number;
}

/**
 * Generate a default/repeated clip schedule as explicit timestamps (seconds).
 *
 * This is the materialisation of the old "interval mode" algorithm: the first
 * clip sits at t=0 (staggered by a deterministic initial delay when jitter > 0),
 * then each clip starts `clipDuration` + `interval ± jitter` after the previous
 * one, filling the timeline. It is used both as the reactive "auto" default for
 * tracks with no stored schedule and as the one-shot "Distribute evenly" tool.
 */
export function generateLoopTimestamps({
  soundId,
  durationSecPerIteration,
  fallbackDurationSec,
  intervalSec,
  jitterSec,
  timelineSec,
}: GenerateLoopTimestampsArgs): number[] {
  const jitterMs = Math.max(0, jitterSec) * 1000;
  const baseGapMs = Math.max(0, intervalSec) * 1000;
  const out: number[] = [];
  let tMs = jitterMs > 0 ? computeInitialDelay(soundId, jitterMs) : 0;
  let idx = 0;

  while (tMs < timelineSec * 1000 && out.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY) {
    out.push(parseFloat((tMs / 1000).toFixed(3)));
    const perIter = durationSecPerIteration?.[idx]
      ?? durationSecPerIteration?.[durationSecPerIteration.length - 1];
    const durSec = perIter ?? fallbackDurationSec;
    const gapMs = Math.max(0, baseGapMs + computeIterationJitter(soundId, idx, jitterMs));
    tMs += Math.max(0, durSec) * 1000 + gapMs;
    idx++;
  }

  return out;
}

/**
 * Get color based on sound generation method
 * @param metadata - Sound metadata containing soundEvent
 * @returns Color hex string
 */
function getSoundColor(metadata: SoundMetadata): string {
  const soundEvent = metadata.soundEvent;

  if (!soundEvent) {
    return 'var(--color-primary)'; // Default to TTA color
  }

  // Imported sounds (uploaded)
  if (soundEvent.isUploaded) {
    return 'var(--color-info)';
  }

  // Library sounds (from BBC or Freesound)
  // Check if URL contains library indicators
  if (soundEvent.url && (soundEvent.url.includes('library') || soundEvent.url.includes('bbc') || soundEvent.url.includes('freesound'))) {
    return 'var(--color-success)';
  }

  // Text-to-Audio (TangoFlux generated)
  return 'var(--color-primary)';
}

/**
 * Extract timeline sounds from soundscape data (when schedulers don't exist)
 *
 * This function creates timeline visualization from configured sounds,
 * independent of whether sounds are currently playing/scheduled.
 * Used to keep timeline visible when sounds are stopped.
 *
 * Scheduling is purely timestamp-driven. A track either has an explicit
 * `soundTimestamps` entry (store) or is "auto" — in which case a default loop is
 * derived reactively from the event's interval_seconds (0 = back-to-back pack).
 *
 * @param soundMetadata - Map of sound metadata (contains buffers, URLs, display names)
 * @param timelineDuration - Timeline duration in milliseconds
 * @returns Array of TimelineSound objects ready for visualization
 */
export function extractTimelineSoundsFromData(
  soundMetadata: Map<string, SoundMetadata>,
  timelineDuration: number = AUDIO_TIMELINE.DEFAULT_DURATION_MS,
  soundEvents?: SoundEvent[],
  soundTrims?: Record<string, { start: number; end: number }>,
  soundTimestamps?: Record<string, number[]>,
  soundIterationDurations?: Record<string, number[]>,
  iterationLinks?: Record<string, IterationLink>,
): TimelineSound[] {
  const timelineSounds: TimelineSound[] = [];

  console.log('[timeline:extract] === BEGIN === metadata.size:', soundMetadata.size,
    'soundEvents.length:', soundEvents?.length ?? 0);
  if (soundEvents?.length) {
    console.log('[timeline:extract] soundEvent IDs (first 10):',
      soundEvents.slice(0, 10).map((e: any) => ({ id: e.id, pi: e.prompt_index, sci: e.speech_card_index, cat: e.category })));
  }
  // Log metadata entries too
  const metaEntries = Array.from(soundMetadata.entries());
  if (metaEntries.length) {
    console.log('[timeline:extract] metadata entries (first 10):',
      metaEntries.slice(0, 10).map(([id, meta]) => ({
        id,
        pi: meta.soundEvent.prompt_index,
        sci: (meta.soundEvent as any).speech_card_index,
        cat: (meta.soundEvent as any).category,
        hasBuffer: !!meta.buffer,
      })));
  }

  // For multi-variant sounds (generated_X_0, generated_X_1, …) only render one track per
  // prompt_index — the variant with the lowest copy-index (i.e. variant A / the default).
  // All variants remain loaded in the AudioOrchestrator so per-iteration overrides still work.
  const primarySoundIds = new Set<string>();
  const promptPrimary = new Map<number, { id: string; copyIdx: number }>();
  soundMetadata.forEach((metadata, soundId) => {
    const pi = metadata.soundEvent.prompt_index;
    if (pi === undefined) { primarySoundIds.add(soundId); return; }
    // Use the actual copy_index from the sound event metadata (not parsed from ID,
    // which fails for TTS IDs like "tts_6_0_Kore" where the last segment is a voice name).
    const copyIdx = (metadata.soundEvent as any).copy_index ?? 0;
    const existing = promptPrimary.get(pi);
    if (!existing || copyIdx < existing.copyIdx) promptPrimary.set(pi, { id: soundId, copyIdx });
  });
  promptPrimary.forEach(({ id }) => primarySoundIds.add(id));
  console.log('[timeline:extract] dedup: promptPrimary.size:', promptPrimary.size,
    'primarySoundIds.size:', primarySoundIds.size,
    'keys:', [...promptPrimary.keys()]);

  soundMetadata.forEach((metadata, soundId) => {
    if (!primarySoundIds.has(soundId)) {
      console.log('[timeline:extract] SKIP soundId:', soundId, 'reason: not primary');
      return;
    }
    if (!metadata.buffer) {
      console.log('[timeline:extract] SKIP soundId:', soundId, 'reason: no buffer');
      return;
    }

    const bufferDurationMs = metadata.buffer.duration * 1000;
    const trim = soundTrims?.[soundId];
    const soundDurationMs = trim ? bufferDurationMs * (trim.end - trim.start) : bufferDurationMs;

    // Override display name from soundEvents if available (reflects user renames via handleSaveName)
    const eventOverride = soundEvents?.find(e => e.id === soundId);
    const displayName = eventOverride?.display_name || metadata.soundEvent.display_name || soundId;

    // Get color based on generation method
    const color = getSoundColor(metadata);

    console.log(`[DEBUG-TIMELINE] soundId=${soundId} cat="${(eventOverride as any)?.category ?? (metadata.soundEvent as any).category ?? 'MISSING'}" promptIdx=${eventOverride?.prompt_index ?? metadata.soundEvent.prompt_index}`);

    // ── Resolve the track's source schedule (seconds) ────────────────────────
    // Explicit store entries win. When a track has NO entry it is "auto": use
    // authored MM:SS timestamps if present, else derive a default loop from the
    // event's interval_seconds (0 = back-to-back pack) with no variability.
    const explicitSec = soundTimestamps?.[soundId];
    let sourceSec: number[];
    if (explicitSec !== undefined) {
      sourceSec = explicitSec;
    } else {
      const rawEvent = metadata.soundEvent as any;
      const authored = rawEvent.timestamps?.length
        ? (rawEvent.timestamps as string[]).map((t) => {
            const [mm, ss] = String(t).split(':').map(Number);
            return (mm ?? 0) * 60 + (ss ?? 0);
          })
        : null;
      sourceSec = authored ?? generateLoopTimestamps({
        soundId,
        fallbackDurationSec: soundDurationMs / 1000,
        intervalSec: rawEvent.current_interval_seconds ?? rawEvent.interval_seconds ?? 30,
        jitterSec: 0,
        timelineSec: timelineDuration / 1000,
      });
    }

    // ── Build visible clips: source timestamps (seconds) → ms, filtered to the
    // timeline bounds. Original index is tracked so the DAW can look up the
    // correct iterationLink badge even when earlier iterations are filtered out
    // (e.g. UNRESOLVED/out-of-range parametric slots).
    const rawMs = sourceSec.map((s) => s * 1000);
    console.log('[timeline:extract] soundId:', soundId, 'timelineDurMs:', timelineDuration,
      'rawTsMs:', rawMs.map(m => Math.round(m)));
    const rawDurs = soundIterationDurations?.[soundId];
    const iterations: number[] = [];
    const iterationOriginalIndices: number[] = [];
    const iterationDurationsMs: number[] = [];
    const iterationAudioUrls: string[] = [];
    for (let idx = 0; idx < rawMs.length && iterations.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY; idx++) {
      const ms = rawMs[idx];
      if (ms >= 0 && ms < timelineDuration) {
        iterations.push(ms);
        iterationOriginalIndices.push(idx);
        const storeDur = rawDurs?.[idx];
        const fallbackDur = storeDur && storeDur > 0 ? storeDur : soundDurationMs;
        const variantInfo = getIterationVariantInfo(
          soundId,
          idx,
          soundMetadata,
          metadata,
          iterationLinks,
          soundTrims,
          fallbackDur,
          soundEvents,
        );
        iterationDurationsMs.push(variantInfo.durationMs);
        iterationAudioUrls.push(variantInfo.audioUrl);
      }
    }

    // Primary copy URL — used as fallback when iterationAudioUrls is absent
    const audioUrl = metadata.soundEvent.url;

    // Map category → soundGroup for DAW grouping
    const rawCategory = eventOverride?.category ?? (metadata.soundEvent as any).category;
    let soundGroup: 'background' | 'sound_event' | 'speech' | undefined;
    if (rawCategory) {
      const cat = rawCategory.toLowerCase().replace(/[\s-]+/g, '_');
      if (cat === 'background' || cat === 'background_sound') soundGroup = 'background';
      else if (cat === 'sound_event' || cat === 'sound event') soundGroup = 'sound_event';
      else if (cat === 'speech') soundGroup = 'speech';
    }

    // cardIndex  — always the 0-based config array position (even for speech-line
    //               TTS sounds where prompt_index encodes line+card together).
    // promptIndex — the sound's raw prompt_index from the backend, used for
    //               deduplication and variant/entity filtering.
    const rawPromptIndex = eventOverride?.prompt_index ?? metadata.soundEvent.prompt_index;
    const speechCardIndex = (eventOverride as any)?.speech_card_index ?? (metadata.soundEvent as any).speech_card_index;
    const cardIndex = (speechCardIndex != null) ? speechCardIndex : rawPromptIndex;

    timelineSounds.push({
      id: soundId,
      displayName,
      color,
      soundDurationMs,
      scheduledIterations: iterations,
      scheduledIterationOriginalIndices: iterationOriginalIndices,
      iterationDurationsMs,
      iterationAudioUrls,
      audioUrl: audioUrl || undefined,
      trimStartFraction: trim?.start,
      trimEndFraction: trim?.end,
      soundGroup,
      promptIndex: rawPromptIndex,
      cardIndex,
    });
    console.log('[timeline:extract] ADDED soundId:', soundId,
      'displayName:', displayName,
      'promptIndex:', rawPromptIndex,
      'cardIndex:', cardIndex,
      'soundGroup:', soundGroup,
      'category:', rawCategory,
      'speechCardIndex:', speechCardIndex,
      'eventOverride:', !!eventOverride,
      'iterations:', iterations.length);
  });

  console.log('[DEBUG-TIMELINE] === extractTimelineSoundsFromData summary ===');
  console.log('[DEBUG-TIMELINE] total timelineSounds:', timelineSounds.length);
  for (const ts of timelineSounds) {
    console.log(`[DEBUG-TIMELINE]   sound id=${ts.id} name="${ts.displayName}" group=${ts.soundGroup} iterations=${ts.scheduledIterations.length}`);
  }

  return timelineSounds;
}

/**
 * Format time in milliseconds to display string
 *
 * @param ms - Time in milliseconds
 * @returns Formatted time string (e.g., "1:23.4")
 */
export function formatTimelineTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1);

  if (minutes > 0) {
    return `${minutes}:${seconds.padStart(4, '0')}`;
  }

  return `${seconds}s`;
}
