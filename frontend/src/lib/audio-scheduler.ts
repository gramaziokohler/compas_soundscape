// lib/audio-scheduler.ts
// Audio Interval Scheduler for interval-based sound playback

import type { ScheduledSound, SoundMetadata } from '@/types/audio';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { scheduledSoundsLogger } from '@/lib/audio/utils/scheduled-sounds-logger';
import { resolveVariantSoundId } from '@/lib/audio/utils/variant-sound-id';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import * as THREE from 'three';

export class AudioScheduler {
  private scheduledSounds: Map<string, ScheduledSound> = new Map();
  private audioOrchestrator: AudioOrchestrator | null = null;
  private audioContext: AudioContext | null = null;

  constructor(audioOrchestrator?: AudioOrchestrator | null, audioContext?: AudioContext | null) {
    this.audioOrchestrator = audioOrchestrator || null;
    this.audioContext = audioContext || null;
  }

  /**
   * Schedule a sound to play at intervals with per-iteration jitter.
   * Interval = sound_duration + intervalSeconds ± jitter (clamped to ≥ 0)
   * Jitter is read live from the audioControlsStore so slider changes take effect immediately.
   */
  scheduleSound(
    soundId: string,
    metadata: SoundMetadata,
    intervalSeconds: number,
    initialDelayMs: number = 0,
    iterationOffsets?: number[],
    startIteration: number = 0
  ): void {
    // Preserve existing offsets if any, because unscheduleSound will clear them
    const existing = this.scheduledSounds.get(soundId);
    const savedOffsets = iterationOffsets || existing?.iterationOffsets;
    
    this.unscheduleSound(soundId);

    const bufferDurationMs = metadata.buffer ? (metadata.buffer.duration * 1000) : 0;
    const trim = useAudioControlsStore.getState().soundTrims[soundId];
    const soundDurationMs = trim ? bufferDurationMs * (trim.end - trim.start) : bufferDurationMs;
    const intervalMs = (intervalSeconds * 1000) + soundDurationMs;

    const displayName = metadata.soundEvent.display_name || soundId;

    this.scheduledSounds.set(soundId, {
      metadata,
      intervalMs,
      timerId: null,
      isScheduled: true,
      initialDelayMs,
      iterationOffsets: savedOffsets,
      currentIteration: startIteration,
    });

    scheduledSoundsLogger.addSound(soundId, displayName, intervalSeconds, performance.now() + initialDelayMs);

    if (initialDelayMs > 0) {
      const timerId = setTimeout(() => {
        this.playOnce(metadata, soundId);
        scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);
        this.scheduleNextPlayback(soundId, metadata, intervalMs);
      }, initialDelayMs);

      const scheduled = this.scheduledSounds.get(soundId);
      if (scheduled) scheduled.timerId = timerId;
    } else {
      this.playOnce(metadata, soundId);
      scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);
      this.scheduleNextPlayback(soundId, metadata, intervalMs);
    }
  }

  /**
   * Schedule the next playback, applying a live ±jitter to the interval.
   * Jitter is read from the store each iteration so the slider takes effect immediately.
   */
  private scheduleNextPlayback(
    soundId: string,
    metadata: SoundMetadata,
    intervalMs: number,
  ): void {
    const scheduled = this.scheduledSounds.get(soundId);
    if (!scheduled) return;

    // Read live jitter and trim from store so slider changes apply to future iterations
    const storeState = useAudioControlsStore.getState();
    const jitterMs = storeState.intervalJitterSeconds * 1000;
    
    // Use pre-generated iteration offset if available, otherwise fallback to on-the-fly random
    const currentIteration = scheduled.currentIteration || 0;
    // Capture the NEXT iteration index before mutating the counter so the timer
    // closure uses the correct (incremented) value rather than the current one.
    const nextIteration = currentIteration + 1;
    let randomOffset = 0;
    if (scheduled.iterationOffsets && currentIteration < scheduled.iterationOffsets.length) {
      randomOffset = scheduled.iterationOffsets[currentIteration];
    } else {
      randomOffset = (Math.random() * 2 - 1) * jitterMs;
    }
    
    // Increment iteration counter
    scheduled.currentIteration = nextIteration;

    // Clamp the GAP between plays (not the total cycle) to >= 0
    // intervalMs = soundDurationMs + gap, so actualInterval = soundDurationMs + max(0, gap + randomOffset)
    const bufferDurationMs = metadata.buffer ? (metadata.buffer.duration * 1000) : 0;
    const trim = storeState.soundTrims[soundId];
    const soundDurationMs = trim ? bufferDurationMs * (trim.end - trim.start) : bufferDurationMs;
    const actualInterval = Math.max(soundDurationMs, intervalMs + randomOffset);

    scheduledSoundsLogger.updateNextPlayback(soundId, performance.now() + actualInterval);

    const timerId = setTimeout(() => {
      this.playOnce(metadata, soundId, nextIteration);
      scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);
      this.scheduleNextPlayback(soundId, metadata, intervalMs);
    }, actualInterval);

    scheduled.timerId = timerId;
  }

  /**
   * Schedule a sound to play at explicit timestamps (one-shot per timestamp).
   * Alternative to scheduleSound() — use when scheduling mode is 'timestamps'.
   *
   * @param soundId - Unique sound identifier
   * @param metadata - Sound metadata (buffer, position, etc.)
   * @param timestampsMs - Array of absolute playback positions in milliseconds
   * @param currentTimeMs - Current timeline playback offset in ms (skips past timestamps)
   */
  scheduleSoundAtTimestamps(
    soundId: string,
    metadata: SoundMetadata,
    timestampsMs: number[],
    currentTimeMs: number = 0
  ): void {
    this.unscheduleSound(soundId);

    const displayName = metadata.soundEvent.display_name || soundId;
    // Filter: must be in the future AND not an unresolved sentinel (999_999 s = 999_999_000 ms).
    const SENTINEL_THRESHOLD_MS = 999_000_000; // 11.5 days — no real sound can be this late
    const futureTimestamps = timestampsMs
      .map((ts, originalIdx) => ({ ts, originalIdx }))
      .filter(({ ts }) => ts >= currentTimeMs && ts < SENTINEL_THRESHOLD_MS);

    if (futureTimestamps.length === 0) {
      console.log(`[AudioScheduler] No future timestamps for ${soundId} at currentTime=${currentTimeMs}ms`);
      return;
    }

    const timers: NodeJS.Timeout[] = [];

    this.scheduledSounds.set(soundId, {
      metadata,
      intervalMs: 0,
      timerId: null,
      isScheduled: true,
      initialDelayMs: Math.max(0, futureTimestamps[0].ts - currentTimeMs),
      timestampsMs,
      timestampTimers: timers,
      currentIteration: 0,
    });

    scheduledSoundsLogger.addSound(soundId, displayName, 0, performance.now() + (futureTimestamps[0].ts - currentTimeMs));

    futureTimestamps.forEach(({ ts: tsMs, originalIdx }) => {
      const delay = tsMs - currentTimeMs;
      const timer = setTimeout(() => {
        this.playOnce(metadata, soundId, originalIdx);
      }, delay);
      timers.push(timer);
    });
  }

  /**
   * Update the interval for a scheduled sound.
   * @deprecated Use Stop All + Play All workflow instead
   */
  updateInterval(soundId: string, newIntervalSeconds: number): void {
    const scheduled = this.scheduledSounds.get(soundId);
    if (!scheduled) return;

    if (scheduled.timerId) clearTimeout(scheduled.timerId);

    const soundDurationMs = scheduled.metadata.buffer ? (scheduled.metadata.buffer.duration * 1000) : 0;
    const newIntervalMs = (newIntervalSeconds * 1000) + soundDurationMs;

    scheduled.intervalMs = newIntervalMs;
    this.scheduleNextPlayback(soundId, scheduled.metadata, newIntervalMs);
  }

  /**
   * Unschedule a sound (stop interval playback)
   */
  unscheduleSound(soundId: string): void {
    const scheduled = this.scheduledSounds.get(soundId);
    if (!scheduled) return;

    // CRITICAL: Delete from map FIRST before clearTimeout
    // This minimizes the race window where a timer callback could execute
    this.scheduledSounds.delete(soundId);

    // Clear pending timer if any
    if (scheduled.timerId) {
      clearTimeout(scheduled.timerId);
    }

    // Clear timestamp-mode one-shot timers
    if (scheduled.timestampTimers) {
      scheduled.timestampTimers.forEach((t) => clearTimeout(t));
    }

    // Stop the audio if it's currently playing
    if (this.audioOrchestrator) {
      try {
        this.audioOrchestrator.stopSource(soundId);
        console.log(`[AudioScheduler] 🛑 Stopped orchestrator source: ${soundId}`);
      } catch (error) {
        console.warn('[AudioScheduler] Failed to stop source:', error);
      }
    }

    // Remove from logger
    scheduledSoundsLogger.removeSound(soundId);
  }

  /**
   * Unschedule all sounds
   */
  unscheduleAll(): void {
    // CRITICAL: Copy timers and clear map FIRST to minimize race window
    const timersToCancel = Array.from(this.scheduledSounds.entries());
    this.scheduledSounds.clear();

    // Now cancel all timers and stop audio
    timersToCancel.forEach(([soundId, scheduled]) => {
      if (scheduled.timerId) {
        clearTimeout(scheduled.timerId);
      }
      // Clear timestamp-mode one-shot timers
      if (scheduled.timestampTimers) {
        scheduled.timestampTimers.forEach((t) => clearTimeout(t));
      }
      // Stop the audio source through orchestrator
      if (this.audioOrchestrator) {
        try {
          this.audioOrchestrator.stopSource(soundId);
        } catch (error) {
          console.warn(`[AudioScheduler] Failed to stop source ${soundId}:`, error);
        }
      }
    });

    // Clear logger
    scheduledSoundsLogger.clear();
  }

  /**
   * Play a sound once (helper method)
   * Routes playback through AudioOrchestrator
   * @param iterationIndex - for per-iteration variant resolution (explicit in timestamps mode,
   *   read from scheduledSounds.currentIteration in interval mode)
   */
  private playOnce(metadata: SoundMetadata, soundId: string, iterationIndex?: number): void {
    if (!metadata.buffer || !this.audioContext) {
      return;
    }

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        this.triggerPlayback(metadata, soundId, iterationIndex);
      });
    } else {
      this.triggerPlayback(metadata, soundId, iterationIndex);
    }
  }

  /**
   * Trigger actual playback through orchestrator.
   * Resolves per-iteration variant overrides from iterationLinks in the store.
   */
  private triggerPlayback(metadata: SoundMetadata, soundId: string, iterationIndex?: number): void {
    // Check if sound is still scheduled (prevents race with unscheduleSound)
    if (!this.scheduledSounds.has(soundId)) {
      return;
    }

    if (this.audioOrchestrator) {
      try {
        // Determine which iteration we are playing
        const iterIdx =
          iterationIndex !== undefined
            ? iterationIndex
            : (this.scheduledSounds.get(soundId)?.currentIteration ?? 0);

        // Check for a per-iteration variant override
        const { iterationLinks, soundTrims } = useAudioControlsStore.getState();
        const link = iterationLinks[`${soundId}-${iterIdx}`];
        let actualSourceId = soundId;
        if (link?.variantIndex !== undefined) {
          const candidate = resolveVariantSoundId(soundId, link.variantIndex);
          const hasCandidate = this.audioOrchestrator?.hasSource(candidate);
          console.log(`[DEBUG-SCHEDULER] triggerPlayback soundId="${soundId}" iterIdx=${iterIdx} link.variantIndex=${link.variantIndex} candidate="${candidate}" hasSource=${hasCandidate}`);
          // Only use the variant source if it actually exists; otherwise fall back
          // to the primary source (copy 0) so playback isn't silently skipped
          // while variant buffers are still loading.
          if (this.audioOrchestrator?.hasSource(candidate)) {
            actualSourceId = candidate;
          } else if (candidate !== soundId) {
            console.warn(
              `[AudioScheduler] Variant source "${candidate}" not yet loaded — falling back to "${soundId}"`,
            );
          }
        }

        const trim = soundTrims[soundId];
        const bufferDuration = metadata.buffer?.duration ?? 0;
        const startOffset = trim ? trim.start * bufferDuration : 0;
        const playDuration = trim ? (trim.end - trim.start) * bufferDuration : undefined;

        this.audioOrchestrator.stopSource(actualSourceId);

        // Apply per-iteration entity position override (after stop, before play).
        // When a link has an explicit entityPosition, move the source there.
        // When there is NO link (or no entityPosition), always reset to the sound's
        // default registered position so that previous iteration overrides don't
        // bleed into un-linked iterations.
        const allLinks = useAudioControlsStore.getState().iterationLinks;
        console.log(`[AudioScheduler] 🎯 triggerPlayback — soundId="${soundId}" iterIdx=${iterIdx}`);
        console.log(`  link key: "${soundId}-${iterIdx}"`, '→ link:', link ?? '(none)');
        console.log(`  all iterationLinks keys:`, Object.keys(allLinks).filter(k => k.startsWith(soundId)));
        if (link?.entityPosition) {
          const pos = link.entityPosition;
          console.log(`  ✅ Using link.entityPosition: [${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}, ${pos[2].toFixed(2)}]`);
          this.audioOrchestrator.updateSourcePosition(
            actualSourceId,
            new THREE.Vector3(pos[0], pos[1], pos[2]),
          );
        } else if (metadata.position) {
          console.log(`  ⚠️ No entityPosition on link — resetting to metadata.position: [${metadata.position.x.toFixed(2)}, ${metadata.position.y.toFixed(2)}, ${metadata.position.z.toFixed(2)}]`);
          this.audioOrchestrator.updateSourcePosition(
            actualSourceId,
            new THREE.Vector3(metadata.position.x, metadata.position.y, metadata.position.z),
          );
        } else {
          console.log(`  ⚠️ No entityPosition and no metadata.position — position unchanged`);
        }

        this.audioOrchestrator.playSource(actualSourceId, false, startOffset, playDuration);
      } catch (error) {
        console.warn(`[AudioScheduler] Failed to play via orchestrator:`, error);
      }
    }
  }

  /**
   * Check if a sound is scheduled
   */
  isScheduled(soundId: string): boolean {
    return this.scheduledSounds.has(soundId);
  }

  /**
   * Get read-only access to scheduled sounds for visualization
   * Used by AudioTimeline component to extract timeline data
   */
  getScheduledSounds(): Map<string, ScheduledSound> {
    return this.scheduledSounds;
  }

  /**
   * Dispose of the scheduler
   */
  dispose(): void {
    this.unscheduleAll();
    scheduledSoundsLogger.clear();
    this.audioOrchestrator = null;
    this.audioContext = null;
  }
}
