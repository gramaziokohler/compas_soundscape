/**
 * IAudioMode Interface
 *
 * Base interface for all audio rendering modes.
 * Each mode (ThreeJS, Resonance, Anechoic, Mono IR, Stereo IR, Ambisonic IR)
 * implements this interface to provide consistent audio source management.
 */

import type { Position, Orientation, AudioMode } from '@/types/audio';
import type { FadeOptions } from '@/lib/audio/utils/fade-envelope';

export interface IAudioMode {
  /**
   * Initialize the mode with audio context
   * @param audioContext - Web Audio API context
   */
  initialize(audioContext: AudioContext): Promise<void>;

  /**
   * Create an audio source at given position
   * @param sourceId - Unique identifier for the source
   * @param audioBuffer - Audio buffer to play
   * @param position - 3D position (THREE.Vector3)
   */
  createSource(
    sourceId: string,
    audioBuffer: AudioBuffer,
    position: Position
  ): void;

  /**
   * Update source position (called when source moves)
   * @param sourceId - Source identifier
   * @param position - New 3D position
   */
  updateSourcePosition(sourceId: string, position: Position): void;

  /**
   * Remove a source and clean up resources
   * @param sourceId - Source identifier
   */
  removeSource(sourceId: string): void;

  /**
   * Update listener position and orientation (called every frame)
   * @param position - Listener 3D position
   * @param orientation - Listener orientation (yaw, pitch, roll)
   */
  updateListener(position: Position, orientation: Orientation): void;

  /**
   * Start audio playback for a source
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio (default: false)
   * @param offset - Start playback from this position in seconds (default: 0)
   * @param duration - Maximum playback duration in seconds (trim end)
   * @param opts - Optional fade-in/out to smooth a loop seam on one-shot playback
   */
  playSource(sourceId: string, loop?: boolean, offset?: number, duration?: number, opts?: FadeOptions): void;

  /**
   * Stop audio playback for a source
   * @param sourceId - Source identifier
   */
  stopSource(sourceId: string): void;

  /**
   * Stop all audio sources immediately
   * Used by emergency kill and stop all functionality
   */
  stopAllSources(): void;

  /**
   * Start a new, independent playback VOICE for an already-registered source, at an
   * ABSOLUTE AudioContext time. Unlike `playSource` (which owns a single source slot
   * and stops whatever was previously playing), multiple voices may be in flight
   * simultaneously for the same source — e.g. overlapping DAW clips — and they all
   * route through that source's persistent gain/mute/convolver chain (built by
   * `createSource`), so mixer and IR state stay correct no matter how many voices
   * are playing at once. This is the primitive `Transport` uses for all timeline
   * playback; `playSource`/`stopSource` remain for other single-shot callers.
   * @param sourceId - Source identifier (must already exist via createSource)
   * @param when - Absolute `audioContext.currentTime` to start at (may be in the
   *   past — Web Audio starts immediately in that case)
   * @param offset - Start playback from this position in seconds (default: 0)
   * @param duration - Maximum playback duration in seconds (trim end)
   * @param opts - Optional fade-in/out to smooth a loop seam
   */
  startVoice(sourceId: string, when: number, offset?: number, duration?: number, opts?: FadeOptions): void;

  /** Immediately stop every in-flight voice for one source (started via startVoice). */
  stopAllVoicesForSource(sourceId: string): void;

  /**
   * Immediately stop every in-flight voice for every source. The single "kill
   * everything" primitive `Transport.stop()`/`seek()` rely on for guaranteed silence
   * — no id-matching between what was scheduled and what is playing can go stale.
   */
  stopAllVoices(): void;

  /**
   * Get the output node for connecting to binaural decoder or destination
   * @returns AudioNode that outputs processed audio
   */
  getOutputNode(): AudioNode;

  /**
   * Check if this mode requires receiver mode (static listener position)
   * @returns true if receiver mode required (IR-based modes), false otherwise
   */
  requiresReceiverMode(): boolean;

  /**
   * Get the mode identifier
   * @returns AudioMode enum value
   */
  getMode(): AudioMode;

  /**
   * Enable the mode (activate audio processing)
   */
  enable(): void;

  /**
   * Disable the mode (deactivate audio processing)
   */
  disable(): void;

  /**
   * Set volume for a specific source (0.0 to 1.0)
   * @param sourceId - Source identifier
   * @param volume - Volume level (0.0 = silent, 1.0 = full volume)
   */
  setSourceVolume(sourceId: string, volume: number): void;

  /**
   * Set mute state for a specific source
   * @param sourceId - Source identifier
   * @param muted - Whether the source should be muted
   */
  setSourceMute(sourceId: string, muted: boolean): void;

  /**
   * Set master/global volume for the entire mode (0.0 to 1.0)
   * @param volume - Master volume level
   */
  setMasterVolume(volume: number): void;

  /**
   * Dispose of all resources
   */
  dispose(): void;
}
