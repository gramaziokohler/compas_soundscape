/**
 * Timeline Utilities
 *
 * Helper functions for extracting and formatting scheduled sound data
 * for the AudioTimeline component.
 */

import { AUDIO_TIMELINE } from '@/utils/constants';
import type { TimelineSound, ScheduledSound, SoundMetadata } from '@/types/audio';
import type { SoundEvent } from '@/types';
import type { AudioScheduler } from '@/lib/audio-scheduler';

/**
 * Get color based on sound generation method
 * @param metadata - Sound metadata containing soundEvent
 * @returns Color hex string
 */
function getSoundColor(metadata: SoundMetadata): string {
  const soundEvent = metadata.soundEvent;

  if (!soundEvent) {
    return AUDIO_TIMELINE.SOUND_COLORS.TTA; // Default to TTA color
  }

  // Imported sounds (uploaded)
  if (soundEvent.isUploaded) {
    return AUDIO_TIMELINE.SOUND_COLORS.IMPORT;
  }

  // Library sounds (from BBC or Freesound)
  // Check if URL contains library indicators
  if (soundEvent.url && (soundEvent.url.includes('library') || soundEvent.url.includes('bbc') || soundEvent.url.includes('freesound'))) {
    return AUDIO_TIMELINE.SOUND_COLORS.LIBRARY;
  }

  // Text-to-Audio (TangoFlux generated)
  return AUDIO_TIMELINE.SOUND_COLORS.TTA;
}

/**
 * Extract timeline sounds from multiple AudioSchedulers
 *
 * Calculates scheduled iterations for each sound based on interval and duration.
 * Limits iterations to prevent performance issues.
 *
 * @param audioSchedulers - Map of AudioScheduler instances (one per sound)
 * @param timelineDuration - Timeline duration in milliseconds
 * @returns Array of TimelineSound objects ready for visualization
 */
export function extractTimelineSounds(
  audioSchedulers: Map<string, AudioScheduler>,
  timelineDuration: number = AUDIO_TIMELINE.DEFAULT_DURATION_MS
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

      // Calculate scheduled iterations
      const iterations: number[] = [];
      let currentTime = initialDelayMs; // Start from initial delay

      // Add iterations only when the iteration END fits within the timeline duration.
      while (
        currentTime + soundDurationMs <= timelineDuration &&
        iterations.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY
      ) {
        iterations.push(currentTime);
        // Next iteration = current + interval (randomness applied in actual playback)
        currentTime += intervalMs;
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
        audioUrl: audioUrl || undefined, // Only include if available
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
  soundTrims?: Record<string, { start: number; end: number }>
): TimelineSound[] {
  const timelineSounds: TimelineSound[] = [];

  soundMetadata.forEach((metadata, soundId) => {
    if (!metadata.buffer) return; // Skip sounds without buffers

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

    // Calculate scheduled iterations
    const iterations: number[] = [];
    let currentTime = 0; // Start from beginning (no initial delay for visualization)

    // Add iterations only when the iteration END fits within the timeline duration.
    // Checking end time (currentTime + soundDurationMs) avoids the last iteration
    // overshooting the cap and inflating actualDuration in the component.
    while (
      currentTime + soundDurationMs <= timelineDuration &&
      iterations.length < AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY
    ) {
      iterations.push(currentTime);
      currentTime += intervalMs;
    }

    // Extract audio URL from metadata (for WaveSurfer waveform visualization)
    const audioUrl = metadata.soundEvent.url;

    timelineSounds.push({
      id: soundId,
      displayName,
      color,
      intervalMs,
      soundDurationMs,
      scheduledIterations: iterations,
      audioUrl: audioUrl || undefined,
      trimStartFraction: trim?.start,
      trimEndFraction: trim?.end,
    });
  });

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
