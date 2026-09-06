/**
 * Transport — the single source of truth for playback time, and the only thing
 * that starts or stops audio voices during timeline playback.
 *
 * THE ONE INVARIANT EVERYTHING ELSE DERIVES FROM:
 *
 *   transportPositionMs = (audioContext.currentTime - startedAtCtxTime) * 1000 + startOffsetMs
 *
 * Nothing else may define timeline time. `performance.now()` and `setTimeout` never
 * appear in the audio path — a coarse (25ms) lookahead timer is only ever used to
 * wake up EARLY, never to be accurate: every clip is started with
 * `AudioBufferSourceNode.start(when)` at an ABSOLUTE `audioContext.currentTime`, so
 * the audio thread — not the timer — places the sample exactly. The UI playhead
 * reads the same clock via `getPositionMs()`, so drawn and heard positions cannot
 * drift apart by construction.
 *
 * Two structural properties fall out of this design:
 *  - A voice has an explicit lifetime: every clip gets a fresh `AudioBufferSourceNode`
 *    that the mode tracks and can stop unconditionally. Stop is "stop every voice",
 *    complete by construction — no id-matching between what's scheduled and what's
 *    playing can get out of sync.
 *  - Seeking is never arithmetic reconstruction of "which iteration am I in". It
 *    kills every in-flight voice, resets the clock, and re-dispatches whichever
 *    clips straddle the new position — the same one code path used at fresh `play()`.
 */

import * as THREE from 'three';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { TimelineScore, ScoreTrack, ScoreClip } from './score';

/** How often the lookahead timer wakes up. Only needs to be "often enough", never exact. */
const LOOKAHEAD_INTERVAL_MS = 25;
/** How far ahead of the current position the lookahead timer schedules clips. */
const LOOKAHEAD_WINDOW_MS = 200;

export class Transport {
  private orchestrator: AudioOrchestrator | null;
  private audioContext: AudioContext | null;

  private score: TimelineScore = { durationMs: 0, tracks: [] };
  /** Default (non-overridden) world position per track, from the live sound metadata. */
  private defaultPositions: Map<string, THREE.Vector3> = new Map();

  private playing = false;
  /** `audioContext.currentTime` at which the current play/seek run started. */
  private startedAtCtxTime = 0;
  /** Timeline position (ms) that `startedAtCtxTime` corresponds to. */
  private startOffsetMs = 0;
  /** Position (ms) frozen while paused/stopped — where the next play() resumes from. */
  private frozenPositionMs = 0;

  /** Clips already dispatched in the current play/seek run — never dispatched twice. */
  private dispatchedClipIds: Set<string> = new Set();
  private lookaheadTimer: ReturnType<typeof setInterval> | null = null;

  private onEndCallback: (() => void) | null = null;

  constructor(orchestrator: AudioOrchestrator | null, audioContext: AudioContext | null) {
    this.orchestrator = orchestrator;
    this.audioContext = audioContext;
  }

  setAudioOrchestrator(orchestrator: AudioOrchestrator | null): void {
    this.orchestrator = orchestrator;
  }

  setAudioContext(audioContext: AudioContext | null): void {
    this.audioContext = audioContext;
  }

  setOnEnd(cb: (() => void) | null): void {
    this.onEndCallback = cb;
  }

  /**
   * Push a freshly-built score. Safe to call at any time, including mid-playback —
   * the lookahead loop reads `this.score` fresh on every tick, so structural edits
   * made during playback take effect on the next tick with no stop/restart, as long
   * as the edited clip's start time is further out than the lookahead window.
   */
  setScore(score: TimelineScore, defaultPositions: Map<string, THREE.Vector3>): void {
    this.score = score;
    this.defaultPositions = defaultPositions;
    // Clamp a frozen (paused/stopped) position to the new duration so a shortened
    // timeline can't leave the playhead stranded past the end.
    if (!this.playing) {
      this.frozenPositionMs = Math.max(0, Math.min(this.frozenPositionMs, this.score.durationMs));
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getDurationMs(): number {
    return this.score.durationMs;
  }

  getPositionMs(): number {
    if (!this.playing || !this.audioContext) return this.frozenPositionMs;
    const pos = (this.audioContext.currentTime - this.startedAtCtxTime) * 1000 + this.startOffsetMs;
    return Math.max(0, Math.min(pos, this.score.durationMs));
  }

  /** Start (or resume) playback from `fromMs`, defaulting to the last frozen (paused/stopped) position. */
  async play(fromMs?: number): Promise<void> {
    if (!this.audioContext || !this.orchestrator) return;

    if (this.audioContext.state !== 'running') {
      try {
        await this.audioContext.resume();
      } catch {
        // If resume fails, starting playback would be silent anyway — bail out.
        return;
      }
    }

    const startMs = fromMs !== undefined ? fromMs : this.frozenPositionMs;

    this.killAllVoices();
    this.dispatchedClipIds.clear();
    this.startOffsetMs = Math.max(0, Math.min(startMs, this.score.durationMs));
    this.startedAtCtxTime = this.audioContext.currentTime;
    this.playing = true;

    // Immediately start (with a mid-clip offset) whichever clips straddle the start point.
    this.dispatchStraddlingClips(this.startOffsetMs);
    this.startLookahead();
  }

  pause(): void {
    if (!this.playing) return;
    this.frozenPositionMs = this.getPositionMs();
    this.playing = false;
    this.stopLookahead();
    this.killAllVoices();
  }

  stop(): void {
    this.playing = false;
    this.frozenPositionMs = 0;
    this.stopLookahead();
    this.killAllVoices();
    this.dispatchedClipIds.clear();
  }

  /** Seek is kill-and-restart, never arithmetic reconstruction of "which iteration am I in". */
  seek(ms: number): void {
    const clamped = Math.max(0, Math.min(ms, this.score.durationMs));
    this.killAllVoices();
    this.dispatchedClipIds.clear();

    if (this.playing && this.audioContext) {
      this.startOffsetMs = clamped;
      this.startedAtCtxTime = this.audioContext.currentTime;
      this.dispatchStraddlingClips(clamped);
    } else {
      this.frozenPositionMs = clamped;
    }
  }

  dispose(): void {
    this.stopLookahead();
    this.killAllVoices();
    this.onEndCallback = null;
    this.orchestrator = null;
    this.audioContext = null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private killAllVoices(): void {
    this.orchestrator?.stopAllVoices();
  }

  private startLookahead(): void {
    this.stopLookahead();
    this.lookaheadTimer = setInterval(() => this.tick(), LOOKAHEAD_INTERVAL_MS);
    // Run one tick immediately so a very short lead (<25ms) isn't missed at start.
    this.tick();
  }

  private stopLookahead(): void {
    if (this.lookaheadTimer !== null) {
      clearInterval(this.lookaheadTimer);
      this.lookaheadTimer = null;
    }
  }

  private tick(): void {
    if (!this.playing || !this.audioContext) return;

    const posMs = this.getPositionMs();

    if (posMs >= this.score.durationMs) {
      this.stop();
      this.onEndCallback?.();
      return;
    }

    const windowEndMs = posMs + LOOKAHEAD_WINDOW_MS;

    for (const track of this.score.tracks) {
      for (const clip of track.clips) {
        if (this.dispatchedClipIds.has(clip.clipId)) continue;

        const clipEndMs = clip.startMs + clip.durationMs;
        if (clipEndMs <= posMs) {
          // Already fully in the past (e.g. a very short clip inside one tick's
          // window) — never play it late, just mark it done.
          this.dispatchedClipIds.add(clip.clipId);
          continue;
        }
        if (clip.startMs >= windowEndMs) continue; // not yet time — check again next tick

        const whenCtx = this.startedAtCtxTime + (clip.startMs - this.startOffsetMs) / 1000;
        this.dispatchClip(track, clip, whenCtx, 0);
        this.dispatchedClipIds.add(clip.clipId);
      }
    }
  }

  /** On play()/seek(), start (with a mid-clip offset) any clip whose window contains `posMs`. */
  private dispatchStraddlingClips(posMs: number): void {
    if (!this.audioContext) return;

    for (const track of this.score.tracks) {
      for (const clip of track.clips) {
        const clipEndMs = clip.startMs + clip.durationMs;
        if (clip.startMs <= posMs && posMs < clipEndMs) {
          const intoClipMs = posMs - clip.startMs;
          this.dispatchClip(track, clip, this.audioContext.currentTime, intoClipMs);
          this.dispatchedClipIds.add(clip.clipId);
        }
      }
    }
  }

  /**
   * Apply the clip's position (per-clip override or the track's default) and
   * start a voice on its already-resolved source id.
   * @param intoClipMs - How far into the clip's own audible window playback should
   *   start (0 for a clip starting fresh at its scheduled time).
   */
  private dispatchClip(track: ScoreTrack, clip: ScoreClip, when: number, intoClipMs: number): void {
    if (!this.orchestrator) return;

    const primaryId = track.trackId;
    // Fall back to the primary source if the resolved variant hasn't finished
    // loading yet, so playback isn't silently skipped.
    const sourceId = this.orchestrator.hasSource(clip.sourceId) ? clip.sourceId : primaryId;

    if (clip.position) {
      const [x, y, z] = clip.position;
      this.orchestrator.updateSourcePosition(sourceId, new THREE.Vector3(x, y, z));
    } else {
      const def = this.defaultPositions.get(primaryId);
      if (def) this.orchestrator.updateSourcePosition(sourceId, def);
    }

    const bufferDuration = this.orchestrator.getSourceBufferDuration(sourceId) ?? 0;
    const trimStartSec = clip.trimStartFraction * bufferDuration;
    const offsetSec = trimStartSec + intoClipMs / 1000;
    const remainingDurationSec = clip.durationMs / 1000 - intoClipMs / 1000;

    if (remainingDurationSec <= 0) return;

    this.orchestrator.startVoice(sourceId, when, offsetSec, remainingDurationSec, {
      fadeInMs: clip.fadeInMs,
      fadeOutMs: clip.fadeOutMs,
    });
  }
}
