import { useState, useCallback, useEffect } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

/**
 * Audio Normalization Hook
 *
 * Manages normalization state for audio processing.
 * Following the modular architecture pattern:
 * - Single Responsibility: Only manages normalization toggle state
 * - Small and focused: ~50 lines
 * - Integrates with AudioOrchestrator for actual audio processing
 *
 * Normalization applies gain adjustment to prevent clipping when
 * convolving with impulse responses.
 *
 * @param audioOrchestrator - The audio orchestrator instance
 * @returns Normalization state and toggle function
 */
export function useAudioNormalization(audioOrchestrator: AudioOrchestrator | null) {
  const [normalize, setNormalize] = useState<boolean>(false);

  /**
   * Toggle normalization on/off
   */
  const toggleNormalize = useCallback((enabled: boolean) => {
    console.log('[useAudioNormalization] toggleNormalize called:', enabled);
    setNormalize(enabled);
  }, []);

  /**
   * Sync normalization setting with AudioOrchestrator
   * This updates all modes that support normalization (Mono IR, Stereo IR, Ambisonic IR)
   */
  useEffect(() => {
    if (!audioOrchestrator) return;

    console.log('[useAudioNormalization] Updating orchestrator normalize setting:', normalize);
    audioOrchestrator.setNormalize(normalize);
  }, [audioOrchestrator, normalize]);

  /**
   * Reset to default state
   */
  const reset = useCallback(() => {
    setNormalize(false);
  }, []);

  return {
    normalize,
    toggleNormalize,
    reset,
  };
}
