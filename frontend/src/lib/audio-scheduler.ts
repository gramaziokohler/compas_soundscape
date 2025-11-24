// lib/audio-scheduler.ts
// Audio Interval Scheduler for interval-based sound playback

import type { ScheduledSound, SoundMetadata } from '@/types/audio';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { scheduledSoundsLogger } from '@/lib/audio/scheduled-sounds-logger';

export class AudioScheduler {
  private scheduledSounds: Map<string, ScheduledSound> = new Map();
  private audioOrchestrator: AudioOrchestrator | null = null;
  private audioContext: AudioContext | null = null;

  constructor(audioOrchestrator?: AudioOrchestrator | null, audioContext?: AudioContext | null) {
    this.audioOrchestrator = audioOrchestrator || null;
    this.audioContext = audioContext || null;

    console.log('[AudioScheduler] 🎬 Constructed with:', {
      hasOrchestrator: !!audioOrchestrator,
      hasContext: !!audioContext,
      orchestratorType: audioOrchestrator?.constructor.name
    });
  }

  /**
   * Schedule a sound to play at intervals with optional randomness
   * Interval = sound_duration + intervalSeconds + random_variance
   * @param soundId Unique identifier for the sound
   * @param metadata Sound metadata (buffer, position, event data)
   * @param intervalSeconds Interval in seconds (will be added to sound duration)
   * @param randomnessPercent Randomness percentage (0-100). Default 10 means ±10% variation
   * @param initialDelayMs Optional initial delay in milliseconds before first playback
   */
  scheduleSound(
    soundId: string,
    metadata: SoundMetadata,
    intervalSeconds: number,
    randomnessPercent: number = 10,
    initialDelayMs: number = 0
  ): void {
    // Clear existing schedule for this sound
    this.unscheduleSound(soundId);

    // Calculate total interval: sound_duration + interval_seconds
    const soundDurationMs = metadata.buffer ? (metadata.buffer.duration * 1000) : 0;
    const intervalMs = (intervalSeconds * 1000) + soundDurationMs;

    // Get display name from metadata for better logging
    const displayName = metadata.soundEvent.display_name || soundId;

    // Store schedule info
    this.scheduledSounds.set(soundId, {
      metadata,
      intervalMs,
      randomnessPercent,
      timerId: null,
      isScheduled: true,
      initialDelayMs
    });

    // Add to logger
    scheduledSoundsLogger.addSound(soundId, displayName, intervalSeconds, performance.now() + initialDelayMs);

    // If there's an initial delay, wait before first playback
    if (initialDelayMs > 0) {
      const timerId = setTimeout(() => {
        this.playOnce(metadata, soundId);
        // Mark as playing in logger
        scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);
        // Schedule next playback
        this.scheduleNextPlayback(soundId, metadata, intervalMs, randomnessPercent);
      }, initialDelayMs);

      // Update the scheduled sound with initial delay timer
      const scheduled = this.scheduledSounds.get(soundId);
      if (scheduled) {
        scheduled.timerId = timerId;
      }
    } else {
      // Play immediately
      this.playOnce(metadata, soundId);
      // Mark as playing in logger
      scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);
      // Schedule next playback with randomness
      this.scheduleNextPlayback(soundId, metadata, intervalMs, randomnessPercent);
    }
  }

  /**
   * Schedule the next playback with randomness applied
   */
  private scheduleNextPlayback(
    soundId: string,
    metadata: SoundMetadata,
    intervalMs: number,
    randomnessPercent: number
  ): void {
    const scheduled = this.scheduledSounds.get(soundId);
    if (!scheduled) return;

    // Apply randomness: intervalMs * (1 ± randomnessPercent/100)
    const randomFactor = 1 + ((Math.random() * 2 - 1) * (randomnessPercent / 100));
    const actualInterval = intervalMs * randomFactor;

    // Update logger with next playback time
    scheduledSoundsLogger.updateNextPlayback(soundId, performance.now() + actualInterval);

    const timerId = setTimeout(() => {
      this.playOnce(metadata, soundId);
      // Mark as playing in logger
      scheduledSoundsLogger.markPlaying(soundId, performance.now() + intervalMs);

      // Schedule next playback
      this.scheduleNextPlayback(soundId, metadata, intervalMs, randomnessPercent);
    }, actualInterval);

    // Update the scheduled sound with new timer
    scheduled.timerId = timerId;
  }

  /**
   * Update the interval for a scheduled sound
   * NOTE: This method is no longer used - interval changes now trigger Stop All
   * @deprecated Use Stop All + Play All workflow instead
   */
  updateInterval(soundId: string, newIntervalSeconds: number): void {
    const scheduled = this.scheduledSounds.get(soundId);
    if (!scheduled) return;

    // Clear old timer
    if (scheduled.timerId) {
      clearTimeout(scheduled.timerId);
    }

    // Calculate new total interval: sound_duration + interval_seconds
    const soundDurationMs = scheduled.metadata.buffer ? (scheduled.metadata.buffer.duration * 1000) : 0;
    const newIntervalMs = (newIntervalSeconds * 1000) + soundDurationMs;

    // Update interval and reschedule
    scheduled.intervalMs = newIntervalMs;
    this.scheduleNextPlayback(soundId, scheduled.metadata, newIntervalMs, scheduled.randomnessPercent);
  }

  /**
   * Unschedule a sound (stop interval playback)
   */
  unscheduleSound(soundId: string): void {
    const scheduled = this.scheduledSounds.get(soundId);
    if (scheduled && scheduled.timerId) {
      // CRITICAL: Delete from map FIRST before clearTimeout
      // This minimizes the race window where a timer callback could execute
      this.scheduledSounds.delete(soundId);
      clearTimeout(scheduled.timerId);

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
    const displayName = metadata.soundEvent.display_name || soundId;
    console.log(`[AudioScheduler] 📢 playOnce called for "${displayName}"`);
    console.log(`  - Has buffer:`, !!metadata.buffer);
    console.log(`  - Has audioContext:`, !!this.audioContext);
    console.log(`  - Context state:`, this.audioContext?.state);

    if (!metadata.buffer || !this.audioContext) {
      console.error(`[AudioScheduler] ❌ Cannot play "${displayName}" - missing buffer or context`);
      return;
    }

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      console.log(`[AudioScheduler] ⏸️ Context suspended for "${displayName}" - resuming...`);
      this.audioContext.resume().then(() => {
        console.log(`[AudioScheduler] ✅ Context resumed for "${displayName}"`);
        this.triggerPlayback(metadata, soundId);
      });
    } else {
      console.log(`[AudioScheduler] ▶️ Context ready for "${displayName}" - triggering playback`);
      this.triggerPlayback(metadata, soundId);
    }
  }

  /**
   * Trigger actual playback through orchestrator
   */
  private triggerPlayback(metadata: SoundMetadata, soundId: string): void {
    // CRITICAL: Check if sound is still scheduled
    // This prevents race condition where timer callback executes AFTER unscheduleSound
    if (!this.scheduledSounds.has(soundId)) {
      const displayName = metadata.soundEvent.display_name || soundId;
      console.log(`[AudioScheduler] ⏹️ Skipping playback for "${displayName}" - no longer scheduled`);
      console.log(`  - Sound ID: ${soundId}`);
      console.log(`  - Reason: Unscheduled during timer callback execution (race condition prevented)`);
      return;
    }

    // Get display name for logging
    const displayName = metadata.soundEvent.display_name || soundId;

    if (this.audioOrchestrator) {
      // Play through orchestrator
      // This ensures mode-specific processing (IR convolution, spatial audio, etc.)
      console.log(`[AudioScheduler] 🎵 Playing "${displayName}" via ORCHESTRATOR`);
      console.log(`  - Sound ID: ${soundId}`);
      console.log(`  - Orchestrator mode:`, this.audioOrchestrator.getStatus().currentMode);

      try {
        this.audioOrchestrator.stopSource(soundId); // Stop if currently playing
        this.audioOrchestrator.playSource(soundId, false); // Non-looping for interval playback
        console.log(`  ✅ Orchestrator playback initiated`);
      } catch (error) {
        console.warn(`[AudioScheduler] ❌ Failed to play via orchestrator:`, error);
      }
    } else {
      console.error('[AudioScheduler] ❌ No orchestrator available');
      console.error(`  - Sound ID: ${soundId}`);
      console.error(`  - Display name: ${displayName}`);
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
