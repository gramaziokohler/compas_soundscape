// lib/audio-scheduler.ts
// Audio Interval Scheduler for interval-based sound playback

import type { ScheduledSound, SoundMetadata } from '@/types/audio';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { scheduledSoundsLogger } from '@/lib/audio/utils/scheduled-sounds-logger';
import { useAudioControlsStore } from '@/store/audioControlsStore';

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
    let randomOffset = 0;
    if (scheduled.iterationOffsets && currentIteration < scheduled.iterationOffsets.length) {
      randomOffset = scheduled.iterationOffsets[currentIteration];
    } else {
      randomOffset = (Math.random() * 2 - 1) * jitterMs;
    }
    
    // Increment iteration counter
    scheduled.currentIteration = currentIteration + 1;

    // Clamp the GAP between plays (not the total cycle) to >= 0
    // intervalMs = soundDurationMs + gap, so actualInterval = soundDurationMs + max(0, gap + randomOffset)
    const bufferDurationMs = metadata.buffer ? (metadata.buffer.duration * 1000) : 0;
    const trim = storeState.soundTrims[soundId];
    const soundDurationMs = trim ? bufferDurationMs * (trim.end - trim.start) : bufferDurationMs;
    const actualInterval = Math.max(soundDurationMs, intervalMs + randomOffset);

    scheduledSoundsLogger.updateNextPlayback(soundId, performance.now() + actualInterval);

    const timerId = setTimeout(() => {
      this.playOnce(metadata, soundId);
      scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);
      this.scheduleNextPlayback(soundId, metadata, intervalMs);
    }, actualInterval);

    scheduled.timerId = timerId;
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
   */
  private playOnce(metadata: SoundMetadata, soundId: string): void {
    if (!metadata.buffer || !this.audioContext) {
      return;
    }

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        this.triggerPlayback(metadata, soundId);
      });
    } else {
      this.triggerPlayback(metadata, soundId);
    }
  }

  /**
   * Trigger actual playback through orchestrator
   */
  private triggerPlayback(metadata: SoundMetadata, soundId: string): void {
    // Check if sound is still scheduled (prevents race with unscheduleSound)
    if (!this.scheduledSounds.has(soundId)) {
      return;
    }

    if (this.audioOrchestrator) {
      try {
        // Apply trim: read current trim from store
        const trim = useAudioControlsStore.getState().soundTrims[soundId];
        const bufferDuration = metadata.buffer?.duration ?? 0;
        const startOffset = trim ? trim.start * bufferDuration : 0;
        const playDuration = trim ? (trim.end - trim.start) * bufferDuration : undefined;

        this.audioOrchestrator.stopSource(soundId);
        this.audioOrchestrator.playSource(soundId, false, startOffset, playDuration);
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
  getScheduledSounds(): ReadonlyMap<string, ScheduledSound> {
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
