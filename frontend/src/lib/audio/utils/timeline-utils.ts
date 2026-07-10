/**
 * Timeline Utilities
 *
 * Helper functions for extracting and formatting scheduled sound data
 * for the AudioTimeline component.
 */

import { AUDIO_TIMELINE } from '@/utils/constants';
import type { TimelineSound, ScheduledSound, SoundMetadata, IterationLink } from '@/types/audio';
import type { SoundEvent } from '@/types';
import type { AudioScheduler } from '@/lib/audio-scheduler';
import { resolveVariantSoundId } from '@/lib/audio/utils/variant-sound-id';

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
  const variantId = resolveVariantSoundId(primarySoundId, variantIdx);
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
 * Compute a deterministic jitter offset for a sound's specific iteration.
 * Uses sound ID + iteration index to ensure the offset is stable across renders,
 * preventing timeline refreshes when metadata updates trigger re-extraction.
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

  // Map hash to range [0, 1]
  const normalized = hash / 0xffffffff;
  // Map to [-1, 1] then multiply by maxJitterMs
  return (normalized * 2 - 1) * maxJitterMs;
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
 * Extract timeline sounds from multiple AudioSchedulers
 *
 * Calculates scheduled iterations for each sound based on interval and duration.
 * Limits iterations to prevent performance issues.
 *
 * @param audioSchedulers - Map of AudioScheduler instances (one per sound)
 * @param timelineDuration - Timeline duration in milliseconds
 * @param soundSchedulingModes - Optional per-sound scheduling modes from store
 * @param soundTimestamps - Optional per-sound explicit timestamps in seconds from store
 * @returns Array of TimelineSound objects ready for visualization
 */
export function extractTimelineSounds(
  audioSchedulers: Map<string, AudioScheduler>,
  timelineDuration: number = AUDIO_TIMELINE.DEFAULT_DURATION_MS,
  soundSchedulingModes?: Record<string, 'interval' | 'timestamps'>,
  soundTimestamps?: Record<string, number[]>
): TimelineSound[] {
  const timelineSounds: TimelineSound[] = [];

  audioSchedulers.forEach((scheduler) => {
    const scheduledSounds = scheduler.getScheduledSounds();

    scheduledSounds.forEach((scheduled, schedSoundId) => {
      const metadata = scheduled.metadata;
      const soundDurationMs = metadata.buffer ? metadata.buffer.duration * 1000 : 0;
      const intervalMs = scheduled.intervalMs;
      const initialDelayMs = scheduled.initialDelayMs || 0;

      // Get display name from metadata
      const displayName = metadata.soundEvent.display_name || schedSoundId;

      // Get color based on generation method
      const color = getSoundColor(metadata);

      const schedulingMode = soundSchedulingModes?.[schedSoundId] ?? 'interval';

      let iterations: number[];
      let iterationOriginalIndices: number[] | undefined;

      if (schedulingMode === 'timestamps' && soundTimestamps?.[schedSoundId]) {
        // Timestamps mode: use explicit timestamps directly (converted to ms).
        // Filter on START time only (not end) so that sounds starting near the boundary
        // are still visible even if they clip. The sentinel 999_999_000 for unresolved
        // iterations is naturally excluded because 999_999_000 >= timelineDuration.
        // We also track the ORIGINAL iteration index so that DAWTrack can still look up
        // the correct iterationLink badge even when some earlier iterations are filtered out.
        const rawMs = soundTimestamps[schedSoundId].map((s) => s * 1000);
        iterations = [];
        iterationOriginalIndices = [];
        for (let idx = 0; idx < rawMs.length && iterations.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY; idx++) {
          const ms = rawMs[idx];
          if (ms >= 0 && ms < timelineDuration) {
            iterations.push(ms);
            iterationOriginalIndices.push(idx);
          }
        }
      } else {
        // Interval mode: calculate iterations from interval (original logic)
        iterations = [];
        let currentTime = initialDelayMs;
        while (
          currentTime + soundDurationMs <= timelineDuration &&
          iterations.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY
        ) {
          iterations.push(currentTime);
          currentTime += intervalMs;
        }
      }

      // Extract audio URL from metadata (for WaveSurfer waveform visualization)
      const audioUrl = metadata.soundEvent.url;

      timelineSounds.push({
        id: schedSoundId,
        displayName,
        color,
        intervalMs,
        soundDurationMs,
        scheduledIterations: iterations,
        scheduledIterationOriginalIndices: iterationOriginalIndices,
        audioUrl: audioUrl || undefined,
        initialDelayMs,
        schedulingMode,
        promptIndex: metadata.soundEvent.prompt_index,
      });
    });
  });

  return timelineSounds;
}

/**
 * Calculate optimal timeline duration based on scheduled sounds from multiple schedulers
 *
 * Ensures all sounds have at least a few iterations visible.
 *
 * @param audioSchedulers - Map of AudioScheduler instances
 * @param minIterationsPerSound - Minimum iterations to show per sound (default: 3)
 * @returns Optimal timeline duration in milliseconds
 */
export function calculateTimelineDuration(
  audioSchedulers: Map<string, AudioScheduler>,
  minIterationsPerSound: number = AUDIO_TIMELINE.MIN_ITERATIONS_PER_SOUND
): number {
  if (audioSchedulers.size === 0) {
    return AUDIO_TIMELINE.DEFAULT_DURATION_MS;
  }

  // Start at 0 — let actual content drive the duration (no artificial floor)
  let maxDuration = 0;

  audioSchedulers.forEach((scheduler) => {
    const scheduledSounds = scheduler.getScheduledSounds();

    scheduledSounds.forEach((scheduled) => {
      // Duration needed for minimum iterations
      const neededDuration = scheduled.intervalMs * minIterationsPerSound;
      maxDuration = Math.max(maxDuration, neededDuration);
    });
  });

  if (maxDuration === 0) {
    return AUDIO_TIMELINE.DEFAULT_DURATION_MS;
  }

  return Math.min(maxDuration, AUDIO_TIMELINE.MAX_DURATION_MS);
}

/**
 * Extract timeline sounds from soundscape data (when schedulers don't exist)
 *
 * This function creates timeline visualization from configured sounds,
 * independent of whether sounds are currently playing/scheduled.
 * Used to keep timeline visible when sounds are stopped.
 *
 * @param soundMetadata - Map of sound metadata (contains buffers, URLs, display names)
 * @param soundIntervals - Current interval settings per sound
 * @param timelineDuration - Timeline duration in milliseconds
 * @returns Array of TimelineSound objects ready for visualization
 */
export function extractTimelineSoundsFromData(
  soundMetadata: Map<string, SoundMetadata>,
  soundIntervals: { [key: string]: number },
  timelineDuration: number = AUDIO_TIMELINE.DEFAULT_DURATION_MS,
  soundEvents?: SoundEvent[],
  soundTrims?: Record<string, { start: number; end: number }>,
  intervalJitterSeconds: number = 3,
  soundSchedulingModes?: Record<string, 'interval' | 'timestamps'>,
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

    // Get interval from soundIntervals, fall back to metadata
    const intervalSeconds = soundIntervals[soundId] ?? metadata.soundEvent.interval_seconds ?? 30;
    const intervalMs = (intervalSeconds * 1000) + soundDurationMs;

    // Override display name from soundEvents if available (reflects user renames via handleSaveName)
    const eventOverride = soundEvents?.find(e => e.id === soundId);
    const displayName = eventOverride?.display_name || metadata.soundEvent.display_name || soundId;

    // Get color based on generation method
    const color = getSoundColor(metadata);

    const schedulingMode = soundSchedulingModes?.[soundId] ?? 'interval';

    console.log(`[DEBUG-TIMELINE] soundId=${soundId} schedulingMode=${schedulingMode} (from store: ${soundSchedulingModes?.[soundId] ?? 'MISSING'}) cat="${(eventOverride as any)?.category ?? (metadata.soundEvent as any).category ?? 'MISSING'}" promptIdx=${eventOverride?.prompt_index ?? metadata.soundEvent.prompt_index}`);

    // Timestamps mode: no stagger delay, no jitter — iterations are absolute positions.
    // Interval mode: apply stagger delay so visual offset matches the audio scheduler.
    const initialDelayMs = schedulingMode === 'timestamps'
      ? 0
      : computeInitialDelay(soundId, intervalJitterSeconds * 1000);

    let iterations: number[];
    let iterationOffsets: number[];
    let iterationOriginalIndices: number[] | undefined;
    let iterationDurationsMs: number[] | undefined;
    let iterationAudioUrls: string[] | undefined;

    if (schedulingMode === 'timestamps' && soundTimestamps?.[soundId]) {
      // Timestamps mode: use explicit timestamps (converted to ms), filtered to timeline bounds.
      // ms >= 0 guards against the UNRESOLVED sentinel (999_999 s) and any negative values.
      // Track original index so DAWTrack can look up the correct iterationLink badge even when
      // earlier iterations are filtered out (e.g. unresolved parametric references).
      const rawMs = soundTimestamps[soundId].map((s) => s * 1000);
      console.log('[timeline:extract] soundId:', soundId, 'timelineDurMs:', timelineDuration,
        'rawTsMs:', rawMs.map(m => Math.round(m)));
      const rawDurs = soundIterationDurations?.[soundId];
      iterations = [];
      iterationOriginalIndices = [];
      iterationDurationsMs = [];
      iterationAudioUrls = [];
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
      // No jitter offsets for timestamps mode
      iterationOffsets = [];
    } else {
      // Interval mode: calculate iterations from interval (original logic)
      const jitterMs = intervalJitterSeconds * 1000;
      const baseGapMs = intervalSeconds * 1000;
      iterations = [];
      iterationOffsets = [];
      iterationDurationsMs = [];
      iterationAudioUrls = [];
      let currentTime = initialDelayMs;
      let iterIdx = 0;

      while (
        currentTime < timelineDuration &&
        iterations.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY
      ) {
        iterations.push(currentTime);
        const randomOffset = computeIterationJitter(soundId, iterations.length - 1, jitterMs);
        iterationOffsets.push(randomOffset);
        const variantInfo = getIterationVariantInfo(
          soundId,
          iterIdx,
          soundMetadata,
          metadata,
          iterationLinks,
          soundTrims,
          soundDurationMs,
          soundEvents,
        );
        iterationDurationsMs.push(variantInfo.durationMs);
        iterationAudioUrls.push(variantInfo.audioUrl);
        const actualGapMs = Math.max(0, baseGapMs + randomOffset);
        currentTime += variantInfo.durationMs + actualGapMs;
        iterIdx++;
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
      intervalMs,
      soundDurationMs,
      scheduledIterations: iterations,
      scheduledIterationOriginalIndices: iterationOriginalIndices,
      iterationDurationsMs,
      iterationAudioUrls,
      audioUrl: audioUrl || undefined,
      trimStartFraction: trim?.start,
      trimEndFraction: trim?.end,
      initialDelayMs,
      iterationOffsets,
      schedulingMode,
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
    console.log(`[DEBUG-TIMELINE]   sound id=${ts.id} name="${ts.displayName}" group=${ts.soundGroup} sched=${ts.schedulingMode} iterations=${ts.scheduledIterations.length}`);
  }

  return timelineSounds;
}

/**
 * Calculate optimal timeline duration from soundscape data (when schedulers don't exist)
 *
 * @param soundMetadata - Map of sound metadata
 * @param soundIntervals - Current interval settings per sound
 * @param minIterationsPerSound - Minimum iterations to show per sound (default: 3)
 * @returns Optimal timeline duration in milliseconds
 */
export function calculateTimelineDurationFromData(
  soundMetadata: Map<string, SoundMetadata>,
  soundIntervals: { [key: string]: number },
  minIterationsPerSound: number = AUDIO_TIMELINE.MIN_ITERATIONS_PER_SOUND
): number {
  if (soundMetadata.size === 0) {
    return AUDIO_TIMELINE.DEFAULT_DURATION_MS;
  }

  // Start at 0 — let actual content drive the duration (no artificial floor)
  let maxDuration = 0;

  soundMetadata.forEach((metadata, soundId) => {
    if (!metadata.buffer) return;

    const soundDurationMs = metadata.buffer.duration * 1000;
    const intervalSeconds = soundIntervals[soundId] ?? metadata.soundEvent.interval_seconds ?? 30;
    const intervalMs = (intervalSeconds * 1000) + soundDurationMs;

    // Duration needed for minimum iterations
    const neededDuration = intervalMs * minIterationsPerSound;
    maxDuration = Math.max(maxDuration, neededDuration);
  });

  if (maxDuration === 0) {
    return AUDIO_TIMELINE.DEFAULT_DURATION_MS;
  }

  return Math.min(maxDuration, AUDIO_TIMELINE.MAX_DURATION_MS);
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
