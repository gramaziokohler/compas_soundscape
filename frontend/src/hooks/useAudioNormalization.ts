import { useCallback, useEffect } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useAudioControlsStore } from '@/store';

/**
 * Audio Normalization Hook
 *
 * Reads/writes the global IR-normalization flag from `audioControlsStore` so it
 * survives refresh and syncs to the user's preferences, and mirrors it onto the
 * AudioOrchestrator for the actual convolution gain.
 *
 * @param audioOrchestrator - The audio orchestrator instance
 * @returns Normalization state and toggle function
 */
export function useAudioNormalization(audioOrchestrator: AudioOrchestrator | null) {
  const normalize = useAudioControlsStore((s) => s.normalizeImpulseResponses);
  const setNormalize = useAudioControlsStore((s) => s.setNormalizeImpulseResponses);

  /**
   * Toggle normalization on/off
   */
  const toggleNormalize = useCallback((enabled: boolean) => {
    setNormalize(enabled);
  }, [setNormalize]);

  /**
   * Sync normalization setting with AudioOrchestrator
   * This updates all modes that support normalization (Mono IR, Stereo IR, Ambisonic IR)
   */
  useEffect(() => {
    if (!audioOrchestrator) return;
    audioOrchestrator.setNormalize(normalize);
  }, [audioOrchestrator, normalize]);

  /**
   * Reset to default state
   */
  const reset = useCallback(() => {
    setNormalize(false);
  }, [setNormalize]);

  return {
    normalize,
    toggleNormalize,
    reset,
  };
}
