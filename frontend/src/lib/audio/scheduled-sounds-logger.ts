/**
 * Scheduled Sounds Logger
 *
 * Provides a real-time display of currently scheduled sounds in the console.
 * Updates whenever sounds are scheduled, unscheduled, or state changes.
 */

interface ScheduledSoundInfo {
  displayName: string;
  intervalSeconds: number;
  nextPlaybackMs: number;
  isPlaying: boolean;
}

class ScheduledSoundsLogger {
  private scheduledSounds: Map<string, ScheduledSoundInfo> = new Map();
  private updateTimerId: NodeJS.Timeout | null = null;

  /**
   * Add or update a scheduled sound
   */
  addSound(soundId: string, displayName: string, intervalSeconds: number, nextPlaybackMs: number = 0): void {
    this.scheduledSounds.set(soundId, {
      displayName,
      intervalSeconds,
      nextPlaybackMs,
      isPlaying: nextPlaybackMs === 0 // If nextPlayback is 0, it's playing now
    });
    this.display();
  }

  /**
   * Update when a sound starts playing
   */
  markPlaying(soundId: string, nextPlaybackMs: number): void {
    const sound = this.scheduledSounds.get(soundId);
    if (sound) {
      sound.isPlaying = true;
      sound.nextPlaybackMs = nextPlaybackMs;
      this.display();
    }
  }

  /**
   * Update next playback time for a sound
   */
  updateNextPlayback(soundId: string, nextPlaybackMs: number): void {
    const sound = this.scheduledSounds.get(soundId);
    if (sound) {
      sound.nextPlaybackMs = nextPlaybackMs;
      sound.isPlaying = false;
      this.display();
    }
  }

  /**
   * Remove a sound from the schedule
   */
  removeSound(soundId: string): void {
    this.scheduledSounds.delete(soundId);
    this.display();
  }

  /**
   * Clear all scheduled sounds
   */
  clear(): void {
    this.scheduledSounds.clear();
    this.display();
  }

  /**
   * Display the current state of scheduled sounds
   */
  private display(): void {
    // TEMPORARILY DISABLED: Entire display to preserve debug logs
    // The table was flooding the console and hiding important debug information
    return;

    /*
    // TEMPORARILY DISABLED: console.clear() to preserve debug logs
    // console.clear();

    if (this.scheduledSounds.size === 0) {
      console.log('┌─────────────────────────────────────┐');
      console.log('│   No Scheduled Sounds               │');
      console.log('└─────────────────────────────────────┘');
      return;
    }

    const now = performance.now();
    const sounds = Array.from(this.scheduledSounds.values());

    console.log('┌─────────────────────────────────────────────────────────────────┐');
    console.log('│                    SCHEDULED SOUNDS (Real-time)                 │');
    console.log('├─────────────────────────────────────────────────────────────────┤');
    console.log('│ Sound Name                  | Interval | Next Play | Status     │');
    console.log('├─────────────────────────────────────────────────────────────────┤');

    sounds.forEach((sound) => {
      const name = sound.displayName.padEnd(27).substring(0, 27);
      const interval = `${sound.intervalSeconds}s`.padEnd(8);

      let nextPlay: string;
      let status: string;

      if (sound.isPlaying) {
        const timeUntilNext = Math.max(0, sound.nextPlaybackMs - now);
        nextPlay = `${(timeUntilNext / 1000).toFixed(1)}s`.padEnd(9);
        status = '🔊 Playing';
      } else {
        const timeUntilNext = Math.max(0, sound.nextPlaybackMs - now);
        nextPlay = `${(timeUntilNext / 1000).toFixed(1)}s`.padEnd(9);
        status = '⏰ Scheduled';
      }

      console.log(`│ ${name} | ${interval} | ${nextPlay} | ${status.padEnd(10)} │`);
    });

    console.log('└─────────────────────────────────────────────────────────────────┘');
    console.log(`Total Scheduled: ${sounds.length} sound(s) | Updated: ${new Date().toLocaleTimeString()}`);
    */
  }

  /**
   * Start periodic updates of the display (optional - for countdown timers)
   */
  startPeriodicUpdates(intervalMs: number = 1000): void {
    if (this.updateTimerId) {
      clearInterval(this.updateTimerId);
    }
    this.updateTimerId = setInterval(() => {
      if (this.scheduledSounds.size > 0) {
        this.display();
      }
    }, intervalMs);
  }

  /**
   * Stop periodic updates
   */
  stopPeriodicUpdates(): void {
    if (this.updateTimerId) {
      clearInterval(this.updateTimerId);
      this.updateTimerId = null;
    }
  }

  /**
   * Dispose of the logger
   */
  dispose(): void {
    this.stopPeriodicUpdates();
    this.scheduledSounds.clear();
  }
}

// Export singleton instance
export const scheduledSoundsLogger = new ScheduledSoundsLogger();
