/**
 * Fade envelope utilities for seamless looping and playback smoothing.
 *
 * A "looped" sound plays a periodic slice of its buffer. That slice often has a
 * phase discontinuity at the wrap point, which produces a click. These helpers
 * apply a short gain fade-in/out at each window boundary so the Web Audio graph
 * passes through zero smoothly. (The loop period itself is detected server-side
 * by the queued loop-analysis job, not in the browser.)
 *
 * The same machinery smooths one-shot (non-looping) clips: their buffer start /
 * end can be discontinuous with silence, which clicks. `resolveClipFade` decides
 * which envelope a clip gets.
 */

import { AUDIO_PLAYBACK } from '@/utils/constants';

/** Per-trigger fade options threaded through the audio pipeline. */
export interface FadeOptions {
  /** Fade-in duration in milliseconds at the start of a window. */
  fadeInMs?: number;
  /** Fade-in duration in milliseconds at the end of a window (loop seam). */
  fadeOutMs?: number;
}

/**
 * Decide the fade envelope for a DAW clip from its track's group + loopable flag.
 *
 * - Loopable sounds get a tiny seam fade at both window edges so the wrap is silent.
 * - Non-looping, non-background one-shots (sound events / speech) get a subtle
 *   fade-in/out so an abrupt buffer boundary does not click.
 * - Non-looping background beds are left untouched.
 */
export function resolveClipFade(
  soundGroup: 'background' | 'sound_event' | 'speech' | undefined,
  loopable: boolean,
): FadeOptions | undefined {
  if (loopable) {
    return {
      fadeInMs: AUDIO_PLAYBACK.LOOPABLE_SEAM_FADE_MS,
      fadeOutMs: AUDIO_PLAYBACK.LOOPABLE_SEAM_FADE_MS,
    };
  }
  if (soundGroup !== 'background') {
    return {
      fadeInMs: AUDIO_PLAYBACK.ONE_SHOT_FADE_IN_MS,
      fadeOutMs: AUDIO_PLAYBACK.ONE_SHOT_FADE_OUT_MS,
    };
  }
  return undefined;
}

/**
 * Inserts a transient gain stage between `sourceNode` and `gainSink`, ramping
 * it in/out so a loop window seam or a one-shot boundary does not click.
 *
 * @param durationSec - The length of the window that `sourceNode` is about to
 *   play. Used to anchor the fade-out at the window's audible end. When omitted
 *   the source buffer's own length is used.
 * @param startTimeSec - Absolute `AudioContext` time at which the voice is
 *   scheduled to start. Ramps are anchored here (clamped to now) rather than to
 *   `currentTime`, so a clip scheduled by the lookahead loop actually fades in
 *   instead of completing its ramp before the audio begins. Defaults to now.
 * @returns The AudioNode that `sourceNode` should connect to (normally the
 *   fade gain). If no fade is requested the source connects straight to
 *   `gainSink` and `sourceNode` itself is returned.
 */
export function applyFadeInOut(
  sourceNode: AudioBufferSourceNode,
  gainSink: AudioNode,
  opts: FadeOptions & { durationSec?: number; startTimeSec?: number } = {},
): AudioNode {
  const fadeInSec = (opts.fadeInMs ?? 0) / 1000;
  const fadeOutSec = (opts.fadeOutMs ?? 0) / 1000;

  if (fadeInSec <= 0 && fadeOutSec <= 0) {
    sourceNode.connect(gainSink);
    return sourceNode;
  }

  const ctx = sourceNode.context;
  const now = ctx.currentTime;
  const startSec = Math.max(now, opts.startTimeSec ?? now);

  // The audible window this source will occupy. Prefer the caller-provided
  // remaining duration; fall back to the buffer's own length for a full-buffer
  // play (e.g. `playSource` without a duration).
  const windowSec = opts.durationSec ?? sourceNode.buffer?.duration ?? 0;

  // Never let the two ramps meet/cross on a very short window — clamp each to a
  // third of it so a short clip still passes through silence at both edges.
  const maxFadeSec = windowSec > 0 ? windowSec / 3 : Math.max(fadeInSec, fadeOutSec);
  const inSec = Math.min(fadeInSec, maxFadeSec);
  const outSec = Math.min(fadeOutSec, maxFadeSec);

  const fadeGain = ctx.createGain();
  fadeGain.connect(gainSink);

  // Start from silence and ramp up over the fade-in window.
  fadeGain.gain.setValueAtTime(0, startSec);
  if (inSec > 0) {
    fadeGain.gain.linearRampToValueAtTime(1, startSec + Math.max(0.001, inSec));
  } else {
    fadeGain.gain.setValueAtTime(1, startSec);
  }

  // Fade out so the window's tail approaches silence just before the wrap / end.
  // Anchor on the total window length so the ramp closes where the source stops.
  if (outSec > 0 && windowSec > 0) {
    const fadeStart = startSec + Math.max(inSec, windowSec - outSec);
    if (fadeStart >= startSec) {
      fadeGain.gain.setValueAtTime(1, fadeStart);
      fadeGain.gain.linearRampToValueAtTime(0, fadeStart + outSec);
    }
  }

  sourceNode.connect(fadeGain);
  return fadeGain;
}
