/**
 * PlaybackSchedulerService
 *
 * Thin coordinator around `Transport` — the audio-clock lookahead engine that owns
 * all timeline playback. This class exists so callers (SpeckleScene, the React
 * transport-clock hook) have a stable object to hold a reference to across the
 * async viewer/orchestrator initialization sequence; all the actual scheduling
 * logic lives in `Transport` and `buildScoreFromTimelineSounds`.
 *
 * Architecture: see `frontend/src/lib/audio/transport/Transport.ts` for the single
 * time invariant every part of playback derives from, and why this replaces the
 * old `setTimeout`-chain `AudioScheduler` entirely.
 */
import * as THREE from 'three';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { Transport } from '@/lib/audio/transport/Transport';
import { buildScoreFromTimelineSounds } from '@/lib/audio/transport/build-score';
import type { SoundMetadata, TimelineSound } from '@/types/audio';

export class PlaybackSchedulerService {
  private transport: Transport;

  constructor(audioOrchestrator?: AudioOrchestrator | null, audioContext?: AudioContext | null) {
    this.transport = new Transport(audioOrchestrator || null, audioContext || null);
  }

  /**
   * Set the audio orchestrator after construction.
   *
   * The scheduler is created before the async orchestrator init completes, so the
   * constructor may capture a null orchestrator; the coordinator handles this via
   * setAudioOrchestrator() once it becomes available.
   */
  public setAudioOrchestrator(orchestrator: AudioOrchestrator | null): void {
    this.transport.setAudioOrchestrator(orchestrator);
  }

  public setAudioContext(audioContext: AudioContext | null): void {
    this.transport.setAudioContext(audioContext);
  }

  /** Register a callback fired exactly once when the transport reaches the end of the timeline. */
  public setOnEnd(cb: (() => void) | null): void {
    this.transport.setOnEnd(cb);
  }

  /**
   * Rebuild the declarative score from the current timeline sounds and push it into
   * the transport. Safe to call at any time, including mid-playback — the
   * transport's lookahead loop reads the score fresh every tick, so structural
   * edits made during playback take effect on the next tick with no stop/restart.
   *
   * @param soundMetadata - Used only to resolve each track's DEFAULT (non-overridden)
   *   world position, exactly mirroring what `createSource` originally registered it
   *   with; per-clip position overrides come from `iterationLinks` inside the score.
   */
  public updateScore(
    timelineSounds: TimelineSound[],
    timelineDurationMs: number,
    soundMetadata?: Map<string, SoundMetadata>,
  ): void {
    const score = buildScoreFromTimelineSounds(timelineSounds, timelineDurationMs);

    const defaultPositions = new Map<string, THREE.Vector3>();
    soundMetadata?.forEach((meta, id) => {
      if (meta.position) {
        defaultPositions.set(id, new THREE.Vector3(meta.position.x, meta.position.y, meta.position.z));
      }
    });

    this.transport.setScore(score, defaultPositions);
  }

  /** Start (or resume) playback from `fromMs`, defaulting to the last paused/stopped position. */
  public play(fromMs?: number): Promise<void> {
    return this.transport.play(fromMs);
  }

  public pause(): void {
    this.transport.pause();
  }

  public stop(): void {
    this.transport.stop();
  }

  /** Seek is kill-and-restart, never arithmetic reconstruction of "which iteration am I in". */
  public seek(ms: number): void {
    this.transport.seek(ms);
  }

  public getPositionMs(): number {
    return this.transport.getPositionMs();
  }

  public getDurationMs(): number {
    return this.transport.getDurationMs();
  }

  public isPlaying(): boolean {
    return this.transport.isPlaying();
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this.transport.dispose();
  }
}
