/**
 * Mode Transition Utilities
 *
 * Handles the overlapping crossfade used when switching audio modes so there is
 * no silent gap between the outgoing and incoming mode. The actual voice
 * re-dispatch is owned by `Transport` (via the orchestrator's graph-changed
 * event) — this module only shapes the gain envelope of the handover.
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';

/**
 * Default crossfade window for an overlapping mode handover.
 */
export const DEFAULT_CROSSFADE_DURATION = 0.08; // 80ms

/**
 * Perform an overlapping crossfade between audio modes.
 *
 * Unlike the previous fade-out → disable → fade-in sequence, both modes ramp
 * simultaneously, so there is no silent gap between them. This is used together
 * with `AudioOrchestrator`'s graph-changed notification: the Transport
 * re-dispatches its in-flight voices onto `newMode` while the crossfade is
 * already ramping it up, so timeline playback continues uninterrupted.
 *
 * @param oldMode - Mode currently feeding the output (null on first activation)
 * @param newMode - Mode to bring in
 * @param audioContext - Web Audio context
 * @param durationSec - Crossfade window in seconds
 */
export async function crossfadeModes(
  oldMode: IAudioMode | null,
  newMode: IAudioMode,
  audioContext: AudioContext,
  durationSec: number = DEFAULT_CROSSFADE_DURATION
): Promise<void> {
  // Enable the new mode first so its enabled-flag bookkeeping is correct.
  newMode.enable();

  // First activation (no outgoing mode) — make sure the output is audible.
  if (!oldMode) {
    rampOutputGain(newMode, audioContext, 1, 1, durationSec);
    return;
  }

  // Same instance (e.g. an IR swap within IR mode) — nothing to crossfade and the
  // instance was never faded out, so leave its gain untouched.
  if (oldMode === newMode) {
    return;
  }

  const now = audioContext.currentTime;
  const end = now + durationSec;

  // Ramp new in from silence while ramping the old one out, over the same window.
  rampOutputGain(newMode, audioContext, 0, 1, durationSec);
  const oldNode = safeGetOutputNode(oldMode);
  if (oldNode && 'gain' in oldNode && oldNode.gain instanceof AudioParam) {
    const gainNode = oldNode as GainNode;
    const current = gainNode.gain.value;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(current, now);
    gainNode.gain.linearRampToValueAtTime(0, end);
  }

  // Wait for the ramp to complete before the caller tears the old mode down.
  await delay(durationSec * 1000 + 10);
}

/**
 * Get a mode's output node without throwing if the mode is partially initialized.
 */
function safeGetOutputNode(mode: IAudioMode): AudioNode | null {
  try {
    return mode.getOutputNode();
  } catch {
    return null;
  }
}

/**
 * Ramp a mode's output gain from `from` to `to` over `durationSec`.
 * Modes whose output is not a GainNode are left untouched.
 */
function rampOutputGain(
  mode: IAudioMode,
  audioContext: AudioContext,
  from: number,
  to: number,
  durationSec: number
): void {
  const outputNode = safeGetOutputNode(mode);
  if (!outputNode || !('gain' in outputNode) || !(outputNode.gain instanceof AudioParam)) {
    return;
  }

  const gainNode = outputNode as GainNode;
  const now = audioContext.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(from, now);
  gainNode.gain.linearRampToValueAtTime(to, now + durationSec);
}

/**
 * Utility delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely disconnect audio nodes
 * Handles errors if nodes are already disconnected
 */
export function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch (error) {
    // Node already disconnected, ignore
  }
}

/**
 * Reconnect audio graph with error handling
 * @returns true if successful, false if error
 */
export function safeConnect(
  source: AudioNode,
  destination: AudioNode
): boolean {
  try {
    source.connect(destination);
    return true;
  } catch (error) {
    console.error('[ModeTransition] Failed to connect nodes:', error);
    return false;
  }
}
