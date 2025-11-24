/**
 * Mode Transition Utilities
 *
 * Handles smooth transitions between audio modes without clicks/pops.
 * Implements fade out/in, source stopping, and audio graph rewiring.
 *
 * Workflow:
 * 1. Fade out current mode
 * 2. Stop all sources
 * 3. Disconnect audio graph
 * 4. Switch to new mode
 * 5. Reconnect audio graph
 * 6. Fade in new mode
 */

import type { IAudioMode } from '../core/interfaces/IAudioMode';

/**
 * Transition configuration
 */
export interface TransitionConfig {
  fadeOutDuration: number; // seconds
  fadeInDuration: number; // seconds
  stopSources: boolean; // Stop sources before transition
}

/**
 * Default transition configuration
 */
export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  fadeOutDuration: 0.05, // 50ms fade out
  fadeInDuration: 0.05, // 50ms fade in
  stopSources: true
};

/**
 * Perform smooth transition between audio modes
 *
 * @param oldMode - Current mode to fade out
 * @param newMode - New mode to fade in
 * @param audioContext - Web Audio context
 * @param config - Transition configuration
 */
export async function smoothModeTransition(
  oldMode: IAudioMode | null,
  newMode: IAudioMode,
  audioContext: AudioContext,
  config: TransitionConfig = DEFAULT_TRANSITION_CONFIG
): Promise<void> {
  const now = audioContext.currentTime;

  // Step 1: Fade out old mode
  if (oldMode) {
    await fadeOutMode(oldMode, audioContext, config.fadeOutDuration, now);
    
    // Step 2: Disable old mode (mutes output)
    oldMode.disable();
    
    // Small delay to ensure fade is complete
    await delay(config.fadeOutDuration * 1000 + 10);
  }

  // Step 3: Enable new mode (initially muted)
  newMode.enable();

  // Step 4: Fade in new mode
  await fadeInMode(newMode, audioContext, config.fadeInDuration);
}

/**
 * Fade out mode by ramping down gain
 */
async function fadeOutMode(
  mode: IAudioMode,
  audioContext: AudioContext,
  duration: number,
  startTime: number
): Promise<void> {
  const outputNode = mode.getOutputNode();
  
  // Check if output node is a GainNode or has a gain parameter
  if ('gain' in outputNode && outputNode.gain instanceof AudioParam) {
    const gainNode = outputNode as GainNode;
    gainNode.gain.setValueAtTime(gainNode.gain.value, startTime);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
  }
  // If not a GainNode, mode's disable() will handle muting
}

/**
 * Fade in mode by ramping up gain
 */
async function fadeInMode(
  mode: IAudioMode,
  audioContext: AudioContext,
  duration: number
): Promise<void> {
  const now = audioContext.currentTime;
  const outputNode = mode.getOutputNode();
  
  // Check if output node is a GainNode or has a gain parameter
  if ('gain' in outputNode && outputNode.gain instanceof AudioParam) {
    const gainNode = outputNode as GainNode;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + duration);
  }
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
