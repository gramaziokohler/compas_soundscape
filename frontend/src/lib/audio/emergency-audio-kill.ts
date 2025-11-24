/**
 * Emergency Audio Kill Switch
 *
 * Provides a last-resort failsafe to immediately silence all audio,
 * independent of scheduling, state management, or timers.
 *
 * This is a nuclear option that:
 * - Stops all orchestrator sources
 * - Suspends audio context
 *
 * NOTE: Uses orchestrator exclusively for proper audio routing
 */

import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

/**
 * Emergency kill all audio
 *
 * This is the final failsafe. It doesn't care about state, scheduling,
 * or timers. It just kills everything audio-related immediately.
 *
 * @param orchestrator - The AudioOrchestrator instance
 * @param audioContext - The Web Audio API context
 */
export function emergencyKillAllAudio(
  orchestrator: AudioOrchestrator | null,
  audioContext: AudioContext | null
): void {
  console.log('[EMERGENCY AUDIO KILL] Activating failsafe...');

  // Step 1: Stop all sources through orchestrator
  if (orchestrator) {
    try {
      orchestrator.stopAllSources();
      console.log('[EMERGENCY AUDIO KILL] All orchestrator sources stopped');
    } catch (error) {
      console.error('[EMERGENCY AUDIO KILL] Failed to stop orchestrator sources:', error);
    }
  } else {
    console.warn('[EMERGENCY AUDIO KILL] No orchestrator available');
  }

  // Step 2: Suspend audio context (prevents any audio processing)
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.suspend().catch((error) => {
      console.error('[EMERGENCY AUDIO KILL] Failed to suspend audio context:', error);
    });
    console.log('[EMERGENCY AUDIO KILL] Audio context suspended');
  }

  console.log('[EMERGENCY AUDIO KILL] Failsafe complete');
}

/**
 * Restore audio after emergency kill
 *
 * Resumes the audio context.
 * Individual audio sources will need to be restarted by the normal playback system.
 *
 * @param audioContext - The Web Audio API context
 */
export async function restoreAudioAfterKill(audioContext: AudioContext | null): Promise<void> {
  console.log('[EMERGENCY AUDIO KILL] Restoring audio system...');

  // Resume audio context
  if (audioContext && audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
      console.log('[EMERGENCY AUDIO KILL] Audio context resumed');
    } catch (error) {
      console.error('[EMERGENCY AUDIO KILL] Failed to resume audio context:', error);
    }
  }

  console.log('[EMERGENCY AUDIO KILL] Audio system restored');
}
