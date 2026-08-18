/**
 * Fade envelope utilities for seamless looping and playback smoothing.
 *
 * A "looped" sound plays a periodic slice of its buffer. That slice often has a
 * phase discontinuity at the wrap point, which produces a click. These helpers
 * apply a short gain fade-in/out at each window boundary so the Web Audio graph
 * passes through zero smoothly. (The loop period itself is detected server-side
 * by the queued loop-analysis job, not in the browser.)
 */

/** Per-trigger fade options threaded through the audio pipeline. */
export interface FadeOptions {
  /** Fade-in duration in milliseconds at the start of a window. */
  fadeInMs?: number;
  /** Fade-in duration in milliseconds at the end of a window (loop seam). */
  fadeOutMs?: number;
}

/**
 * Inserts a transient gain stage between `sourceNode` and `gainSink`, ramping
 * it in/out so a loop window seam does not click.
 *
 * @param durationSec - The length of the window that `sourceNode` is about to
 *   play. Used to anchor the fade-out at the window's audible end.
 * @returns The AudioNode that `sourceNode` should connect to (normally the
 *   fade gain). If no fade is requested the source connects straight to
 *   `gainSink` and `sourceNode` itself is returned.
 */
export function applyFadeInOut(
  sourceNode: AudioBufferSourceNode,
  gainSink: AudioNode,
  opts: FadeOptions & { durationSec?: number } = {},
): AudioNode {
  const fadeInSec = (opts.fadeInMs ?? 0) / 1000;
  const fadeOutSec = (opts.fadeOutMs ?? 0) / 1000;

  if (fadeInSec <= 0 && fadeOutSec <= 0) {
    sourceNode.connect(gainSink);
    return sourceNode;
  }

  const ctx = sourceNode.context;
  const now = ctx.currentTime;
  const fadeGain = ctx.createGain();
  fadeGain.connect(gainSink);

  // Start from silence and ramp up over the fade-in window.
  fadeGain.gain.setValueAtTime(0, now);
  fadeGain.gain.linearRampToValueAtTime(1, now + Math.max(0.001, fadeInSec));

  // Fade out so the window's tail approaches silence just before the wrap.
  // Anchor on the total window length so the ramp closes exactly where the
  // source would stop.
  const windowSec = opts.durationSec ?? fadeOutSec;
  if (fadeOutSec > 0 && windowSec > 0) {
    const fadeStart = now + Math.max(fadeInSec, windowSec - fadeOutSec);
    if (fadeStart > now) {
      fadeGain.gain.setValueAtTime(1, fadeStart);
      fadeGain.gain.linearRampToValueAtTime(0, fadeStart + fadeOutSec);
    }
  }

  sourceNode.connect(fadeGain);
  return fadeGain;
}