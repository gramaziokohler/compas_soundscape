import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import { AudioScheduler } from "@/lib/audio-scheduler";
import { AUDIO_PLAYBACK } from "@/utils/constants";
import { emergencyKillAllAudio, restoreAudioAfterKill } from "@/lib/audio/utils/emergency-audio-kill";
import { computeInitialDelay } from "@/lib/audio/utils/timeline-utils";
import type { SoundState } from "@/types";
import type { SoundMetadata, TimelineSound } from "@/types/audio";
import { useAudioControlsStore } from "@/store/audioControlsStore";
import * as THREE from 'three';

/**
 * PlaybackSchedulerService
 *
 * Manages sound scheduling and playback control.
 *
 * Responsibilities:
 * - Individual sound playback scheduling with intervals
 * - Play All detection and staggered start
 * - Sound state management (playing, paused, stopped)
 * - Scheduler lifecycle management
 *
 * Architecture:
 * - Uses AudioOrchestrator for playback routing (ensures mode-specific processing)
 * - Supports all 6 audio modes: ThreeJS, Resonance, Anechoic, Mono IR, Stereo IR, Ambisonic IR
 */
export class PlaybackSchedulerService {
  private audioOrchestrator: AudioOrchestrator | null = null;
  private audioContext: AudioContext | null = null;

  // Audio schedulers (one per sound)
  private audioSchedulers: Map<string, AudioScheduler> = new Map();

  // Track setTimeout timers created during seek (for proper cleanup)
  private seekTimers: Map<string, NodeJS.Timeout> = new Map();

  // Previous state tracking for granular updates
  private prevIndividualSoundStates: { [key: string]: SoundState } = {};
  private prevSoundIntervals: { [key: string]: number } = {};
  private isPlayAll: boolean = false;

  constructor(audioOrchestrator?: AudioOrchestrator | null, audioContext?: AudioContext | null) {
    this.audioOrchestrator = audioOrchestrator || null;
    this.audioContext = audioContext || null;
  }

  /**
   * Update individual sound playback states (granular updates only)
   */
  public async updateSoundPlayback(
    soundMetadata: Map<string, SoundMetadata>,
    individualSoundStates: { [key: string]: SoundState },
    soundIntervals: { [key: string]: number },
    timelineSounds?: TimelineSound[]
  ): Promise<void> {
    if (soundMetadata.size === 0) return;

    // CRITICAL: Resume audio context if suspended (required for playback to start)
    // This must happen BEFORE scheduling sounds, otherwise they won't play
    // MUST AWAIT to ensure context is ready before sounds are scheduled

    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('[PlaybackScheduler] Failed to resume audio context:', error);
        return; // Don't schedule sounds if resume failed
      }
    } else if (this.audioContext && this.audioContext.state !== 'running') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('[PlaybackScheduler] Failed to resume audio context:', error);
      }
    }

    const prevStates = this.prevIndividualSoundStates;
    const prevIntervals = this.prevSoundIntervals;

    // Only process sounds that have changed
    const allSoundIds = new Set([
      ...Object.keys(individualSoundStates),
      ...Object.keys(prevStates)
    ]);

    // Detect if this is a "Play All" scenario (multiple sounds changing to 'playing' at once)
    const soundsChangingToPlaying = Array.from(allSoundIds).filter(soundId => {
      const currentState = individualSoundStates[soundId];
      const prevState = prevStates[soundId];
      return currentState === 'playing' && prevState !== 'playing';
    });

    // Check if sounds are resuming from pause (not starting fresh from stopped)
    const soundsResumingFromPause = soundsChangingToPlaying.filter(soundId => {
      return prevStates[soundId] === 'paused';
    });

    // If 2 or more sounds are starting from stopped, it's "Play All" with stagger
    // If sounds are resuming from pause, don't use stagger (continue where left off)
    // If only 1 sound is starting, it's individual playback
    if (soundsChangingToPlaying.length >= 2 && soundsResumingFromPause.length === 0) {
      this.isPlayAll = true;
    } else {
      this.isPlayAll = false;
    }

    allSoundIds.forEach(soundId => {
      const currentState = individualSoundStates[soundId];
      const prevState = prevStates[soundId];
      const currentInterval = soundIntervals[soundId];
      const prevInterval = prevIntervals[soundId];

      const stateChanged = currentState !== prevState;
      const intervalChanged = currentInterval !== prevInterval;

      const metadata = soundMetadata.get(soundId);
      if (!metadata) {
        console.warn(`[PlaybackScheduler] No metadata for soundId: ${soundId}`);
        return;
      }

      const displayName = metadata.soundEvent.display_name || soundId;

      // Skip if nothing changed for this sound
      if (!stateChanged && !intervalChanged) {
        return;
      }

      if (!metadata.buffer) {
        return;
      }

      // Get or create scheduler for this sound
      let scheduler = this.audioSchedulers.get(soundId);
      if (!scheduler) {
        scheduler = new AudioScheduler(this.audioOrchestrator, this.audioContext);
        this.audioSchedulers.set(soundId, scheduler);
      }

      // Handle state changes
      if (stateChanged) {
        switch (currentState) {
          case 'playing':
            // Only schedule if not already scheduled (prevents restart)
            const isAlreadyScheduled = scheduler.isScheduled(soundId);

            if (!isAlreadyScheduled) {
              // Get interval from soundIntervals (UI), fall back to metadata (sound event), or default
              const soundEventInterval = metadata.soundEvent.interval_seconds;
              const intervalSeconds = (currentInterval !== undefined && currentInterval !== null)
                ? currentInterval
                : (soundEventInterval !== undefined && soundEventInterval !== null)
                  ? soundEventInterval
                  : AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS;

              const jitterMs = useAudioControlsStore.getState().intervalJitterSeconds * 1000;
              let initialDelayMs = 0;
              let iterationOffsets: number[] | undefined = undefined;

              const ts = timelineSounds?.find(t => t.id === soundId);

              if (ts?.schedulingMode === 'timestamps' && ts.scheduledIterations.length > 0) {
                scheduler.scheduleSoundAtTimestamps(soundId, metadata, ts.scheduledIterations, 0);
              } else {
                if (ts && ts.initialDelayMs !== undefined) {
                  initialDelayMs = ts.initialDelayMs;
                  iterationOffsets = ts.iterationOffsets;
                }

                if (!timelineSounds && this.isPlayAll) {
                  initialDelayMs = computeInitialDelay(soundId, jitterMs);
                }

                scheduler.scheduleSound(soundId, metadata, intervalSeconds, initialDelayMs, iterationOffsets);
              }
            }
            break;

          case 'paused':
            // Unschedule and pause
            scheduler.unscheduleSound(soundId);

            // CRITICAL: Stop orchestrator source (direct playback from seek)
            if (this.audioOrchestrator) {
              try {
                this.audioOrchestrator.stopSource(soundId);
              } catch (error) {
                console.warn(`[PlaybackScheduler] Failed to stop source ${soundId}:`, error);
              }
            }

            // CRITICAL: Clear seek timer for this sound
            // This prevents seek timers from restarting paused sounds
            const pauseSeekTimer = this.seekTimers.get(soundId);
            if (pauseSeekTimer) {
              clearTimeout(pauseSeekTimer);
              this.seekTimers.delete(soundId);
            }
            break;

          case 'stopped':
            // Unschedule and stop
            scheduler.unscheduleSound(soundId);

            // CRITICAL: Stop orchestrator source (direct playback from seek)
            // This is the key fix - seek creates direct buffer sources that need stopping
            if (this.audioOrchestrator) {
              try {
                this.audioOrchestrator.stopSource(soundId);
              } catch (error) {
                console.warn(`[PlaybackScheduler] Failed to stop source ${soundId}:`, error);
              }
            }

            // CRITICAL: Clear seek timer for this sound
            // This prevents seek timers from restarting stopped sounds
            const seekTimer = this.seekTimers.get(soundId);
            if (seekTimer) {
              clearTimeout(seekTimer);
              this.seekTimers.delete(soundId);
            }
            break;
        }
      }
      // Handle interval changes (only if sound is playing and interval changed)
      else if (intervalChanged && currentState === 'playing' && scheduler.isScheduled(soundId)) {
        // Get interval from soundIntervals (UI), fall back to metadata (sound event), or default
        const soundEventInterval = metadata.soundEvent.interval_seconds;
        // Use nullish coalescing carefully: 0 is falsy but valid, so check for null/undefined explicitly
        const intervalSeconds = (currentInterval !== undefined && currentInterval !== null)
          ? currentInterval
          : (soundEventInterval !== undefined && soundEventInterval !== null)
            ? soundEventInterval
            : AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS;
        scheduler.updateInterval(soundId, intervalSeconds);
      }
    });

    // Update previous values
    this.prevIndividualSoundStates = { ...individualSoundStates };
    this.prevSoundIntervals = { ...soundIntervals };
  }

  /**
   * Stop and unschedule all sounds
   * Called when variants change or when stopping all playback
   */
  public async stopAllSounds(): Promise<void> {
    // CRITICAL: Clear seek timers FIRST to prevent delayed playback
    // This prevents the bug where sounds restart after being stopped
    this.seekTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.seekTimers.clear();

    // CRITICAL: Stop all sources through the orchestrator FIRST
    // This ensures the actual audio buffers are stopped immediately
    if (this.audioOrchestrator) {
      this.audioOrchestrator.stopAllSources();
    }

    // EMERGENCY KILL SWITCH - Immediately silence all audio at the lowest level
    emergencyKillAllAudio(this.audioOrchestrator, this.audioContext);

    // Unschedule ALL schedulers (including old variants that might still be scheduled)
    this.audioSchedulers.forEach((scheduler, soundId) => {
      scheduler.unscheduleSound(soundId);
    });

    // Clear all schedulers since we stopped everything
    this.audioSchedulers.clear();

    // CRITICAL: Clear previous state tracking to prevent re-scheduling
    // This ensures that after Stop All, updateSoundPlayback won't see any state changes
    this.prevIndividualSoundStates = {};
    this.prevSoundIntervals = {};
    this.isPlayAll = false;

    // Restore audio system (ready for next play)
    // MUST await to ensure audio context is resumed before next playback
    await restoreAudioAfterKill(this.audioContext);
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Clear seek timers
    this.seekTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.seekTimers.clear();

    // Cleanup all schedulers
    this.audioSchedulers.forEach(scheduler => scheduler.dispose());
    this.audioSchedulers.clear();

    // Reset state
    this.prevIndividualSoundStates = {};
    this.prevSoundIntervals = {};
    this.isPlayAll = false;
  }

  /**
   * Get all audio schedulers for timeline visualization
   */
  public getAudioSchedulers(): Map<string, AudioScheduler> {
    return this.audioSchedulers;
  }

  /**
   * Seek to a specific time in the timeline
   * NUCLEAR APPROACH: Completely dispose all schedulers and wait for event loop to clear
   *
   * @param seekTimeMs - The time to seek to in milliseconds
   * @param soundMetadata - Map of all sound metadata
   * @param individualSoundStates - Current sound states
   * @param soundIntervals - Sound intervals configuration
   */
  public async seekToTime(
    seekTimeMs: number,
    soundMetadata: Map<string, SoundMetadata>,
    individualSoundStates: { [key: string]: SoundState },
    soundIntervals: { [key: string]: number },
    timelineSounds?: TimelineSound[]
  ): Promise<void> {

    // NUCLEAR STEP 1: Clear ALL seek timers
    this.seekTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.seekTimers.clear();

    // NUCLEAR STEP 2: Stop all orchestrator sources IMMEDIATELY
    if (this.audioOrchestrator) {
      this.audioOrchestrator.stopAllSources();
    }

    // NUCLEAR STEP 3: DISPOSE ALL SCHEDULERS (not just unschedule)
    // This ensures all internal timers are cleared
    this.audioSchedulers.forEach((scheduler) => {
      scheduler.dispose();
    });
    this.audioSchedulers.clear();

    // NUCLEAR STEP 4: Wait for event loop to clear
    // This ensures any queued timer callbacks have executed and been rejected
    await new Promise(resolve => setTimeout(resolve, 50));

    // Count sounds that should be playing
    const soundsToSchedule = Array.from(soundMetadata.keys()).filter(
      soundId => individualSoundStates[soundId] === 'playing'
    );
    // Track what happens with each sound
    const seekResults: { [key: string]: string } = {};

    // Step 3: For each sound that should be playing, calculate when to play/schedule
    soundMetadata.forEach((metadata, soundId) => {
      const displayName = metadata.soundEvent.display_name || soundId;
      const currentState = individualSoundStates[soundId];

      // Only process sounds that are in 'playing' state
      if (currentState !== 'playing') {
        seekResults[displayName] = `❌ SKIPPED - State: ${currentState || 'undefined'}`;
        return;
      }

      if (!metadata.buffer) {
        seekResults[displayName] = `❌ SKIPPED - No audio buffer`;
        return;
      }

      // Get interval configuration
      const soundEventInterval = metadata.soundEvent.interval_seconds;
      const intervalSeconds = (soundIntervals[soundId] !== undefined && soundIntervals[soundId] !== null)
        ? soundIntervals[soundId]
        : (soundEventInterval !== undefined && soundEventInterval !== null)
          ? soundEventInterval
          : AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS;

      const bufferDurationMs = metadata.buffer.duration * 1000;
      const trim = useAudioControlsStore.getState().soundTrims[soundId];
      const soundDurationMs = trim ? bufferDurationMs * (trim.end - trim.start) : bufferDurationMs;
      const totalIntervalMs = (intervalSeconds * 1000) + soundDurationMs;

      // Create NEW scheduler (fresh, no old state)
      const scheduler = new AudioScheduler(this.audioOrchestrator, this.audioContext);
      this.audioSchedulers.set(soundId, scheduler);

      let timeIntoIteration = 0;
      let nextIterationDelayMs = 0;
      let isWithinSound = false;
      let iterationOffsets: number[] | undefined = undefined;
      // Track the active iteration index so we can apply per-iteration position on seek.
      let seekIterIdx = 0;

      const ts = timelineSounds?.find(t => t.id === soundId);
      if (ts && ts.scheduledIterations && ts.scheduledIterations.length > 0) {
        iterationOffsets = ts.iterationOffsets;

        let activeIterIndex = -1;
        let actualIterationStart = 0;

        for (let i = 0; i < ts.scheduledIterations.length; i++) {
          const iterVisualStart = ts.scheduledIterations[i];
          if (iterVisualStart <= seekTimeMs) {
            activeIterIndex = i;
            actualIterationStart = iterVisualStart;
          } else {
            break;
          }
        }

        if (activeIterIndex >= 0) {
          timeIntoIteration = seekTimeMs - actualIterationStart;
          isWithinSound = timeIntoIteration < ts.soundDurationMs;
          seekIterIdx = activeIterIndex;

          if (!isWithinSound) {
            if (activeIterIndex + 1 < ts.scheduledIterations.length) {
              const nextIterVisualStart = ts.scheduledIterations[activeIterIndex + 1];
              nextIterationDelayMs = nextIterVisualStart - seekTimeMs;
            } else {
              nextIterationDelayMs = totalIntervalMs - timeIntoIteration;
              nextIterationDelayMs = Math.max(0, nextIterationDelayMs);
            }
          }

          scheduler.getScheduledSounds().set(soundId, {
            metadata,
            intervalMs: ts.intervalMs,
            timerId: null,
            isScheduled: true,
            iterationOffsets: ts.iterationOffsets,
            currentIteration: isWithinSound ? activeIterIndex + 1 : activeIterIndex + 1,
            initialDelayMs: ts.initialDelayMs
          });
        } else {
          isWithinSound = false;
          const firstIterVisualStart = ts.scheduledIterations[0];
          nextIterationDelayMs = firstIterVisualStart - seekTimeMs;

          scheduler.getScheduledSounds().set(soundId, {
            metadata,
            intervalMs: ts.intervalMs,
            timerId: null,
            isScheduled: true,
            iterationOffsets: ts.iterationOffsets,
            currentIteration: 0,
            initialDelayMs: Math.max(0, nextIterationDelayMs)
          });
        }
      } else {
        let iterationStartTime = 0;
        let iterationIndex = 0;
        while (iterationStartTime + totalIntervalMs <= seekTimeMs) {
          iterationIndex++;
          iterationStartTime += totalIntervalMs;
        }

        timeIntoIteration = seekTimeMs - iterationStartTime;
        isWithinSound = timeIntoIteration < soundDurationMs;
        seekIterIdx = iterationIndex;
        if (!isWithinSound) {
          nextIterationDelayMs = totalIntervalMs - timeIntoIteration;
        }
      }

      if (isWithinSound) {
        const trimStartSec = trim ? trim.start * (metadata.buffer.duration) : 0;
        const trimDurationSec = trim ? (trim.end - trim.start) * metadata.buffer.duration : undefined;
        const offsetSeconds = trimStartSec + (timeIntoIteration / 1000);

        if (this.audioOrchestrator) {
          try {
            // Apply per-iteration entity position before resuming playback after seek.
            // This mirrors the same logic in AudioScheduler.triggerPlayback.
            const { iterationLinks } = useAudioControlsStore.getState();
            const seekLink = iterationLinks[`${soundId}-${seekIterIdx}`];
            if (seekLink?.entityPosition) {
              const pos = seekLink.entityPosition;
              this.audioOrchestrator.updateSourcePosition(
                soundId,
                new THREE.Vector3(pos[0], pos[1], pos[2]),
              );
            } else if (metadata.position) {
              this.audioOrchestrator.updateSourcePosition(
                soundId,
                new THREE.Vector3(metadata.position.x, metadata.position.y, metadata.position.z),
              );
            }

            this.audioOrchestrator.playSource(soundId, false, offsetSeconds, trimDurationSec !== undefined ? trimDurationSec - (timeIntoIteration / 1000) : undefined);
          } catch (error) {
            console.warn(`[PlaybackScheduler] ❌ Orchestrator playback failed for "${displayName}":`, error);
          }
          } else {
            console.error(`[PlaybackScheduler] No orchestrator available for "${displayName}"`);
          }

        let preciseDelayUntilNextStart = 0;
        let currentIteration = 0;

        if (ts && ts.scheduledIterations) {
           for (let i = 0; i < ts.scheduledIterations.length; i++) {
             if (ts.scheduledIterations[i] <= seekTimeMs) {
               currentIteration = i + 1;
             } else {
               break;
             }
           }

           if (ts.scheduledIterations.length > currentIteration) {
             const nextVisualStart = ts.scheduledIterations[currentIteration];
             if (nextVisualStart > seekTimeMs) {
               preciseDelayUntilNextStart = nextVisualStart - seekTimeMs;
             } else {
               preciseDelayUntilNextStart = 0;
             }
           } else {
             preciseDelayUntilNextStart = Infinity;
           }
        } else {
           const remainingTimeInIterationMs = soundDurationMs - timeIntoIteration;
           preciseDelayUntilNextStart = remainingTimeInIterationMs + (totalIntervalMs - soundDurationMs);
           currentIteration = Math.floor(seekTimeMs / totalIntervalMs) + 1;
        }


        if (preciseDelayUntilNextStart === Infinity) {
          seekResults[displayName] = `✅ PLAYING final iteration from ${(timeIntoIteration / 1000).toFixed(1)}s, STOPPING afterwards`;
        } else {
          preciseDelayUntilNextStart = Math.max(0, preciseDelayUntilNextStart);
          seekResults[displayName] = `✅ PLAYING from ${(timeIntoIteration / 1000).toFixed(1)}s, next in ${(preciseDelayUntilNextStart / 1000).toFixed(1)}s`;

          const timer = setTimeout(() => {
            const currentScheduler = this.audioSchedulers.get(soundId);
            if (!currentScheduler) {
              return;
            }

            currentScheduler.scheduleSound(soundId, metadata, intervalSeconds, 0, ts?.iterationOffsets, currentIteration);
            this.seekTimers.delete(soundId);
          }, preciseDelayUntilNextStart);

          this.seekTimers.set(soundId, timer);
        }

      } else {
        seekResults[displayName] = `⏰ SCHEDULED to play in ${(nextIterationDelayMs / 1000).toFixed(1)}s`;

        let gapIter = 0;
        if (ts && ts.scheduledIterations) {
           for (let i = 0; i < ts.scheduledIterations.length; i++) {
             if (ts.scheduledIterations[i] > seekTimeMs) {
               gapIter = i;
               break;
             }
           }
           if (gapIter >= ts.scheduledIterations.length || (gapIter === 0 && ts.scheduledIterations[0] <= seekTimeMs)) {
             seekResults[displayName] = `🛑 PAST VISUAL DURATION; stopping`;
             return;
           }
        } else {
           gapIter = Math.ceil(seekTimeMs / totalIntervalMs);
        }

        scheduler.scheduleSound(soundId, metadata, intervalSeconds, nextIterationDelayMs, ts?.iterationOffsets, gapIter);
      }
    });

    // Sync prevIndividualSoundStates so that the next updateSoundPlayback call
    // sees no diff and skips rescheduling (prevents double-scheduling after seek).
    this.prevIndividualSoundStates = { ...individualSoundStates };
    this.prevSoundIntervals = { ...soundIntervals };
  }
}
