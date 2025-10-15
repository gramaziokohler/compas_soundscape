import { useState, useCallback } from "react";
import { SoundState } from "@/types";

/**
 * Audio Controls Hook
 *
 * Manages audio playback state for the soundscape application.
 *
 * Architecture:
 * - Each sound has independent state (playing/paused/stopped)
 * - No global "soundscape mode" - all sounds are independent
 * - "Play All" simply starts all sounds individually
 * - Each sound maintains its own playback interval timing
 */
export function useAudioControls(generatedSounds: any[]) {
  // Per-sound state - single source of truth for playback
  const [individualSoundStates, setIndividualSoundStates] = useState<{[key: string]: SoundState}>({});
  const [selectedVariants, setSelectedVariants] = useState<{[key: number]: number}>({});
  const [soundVolumes, setSoundVolumes] = useState<{[key: string]: number}>({});
  const [soundIntervals, setSoundIntervals] = useState<{[key: string]: number}>({});

  /**
   * Toggle a single sound between playing and paused
   */
  const toggleSound = useCallback((soundId: string) => {
    setIndividualSoundStates(prev => {
      const currentState = prev[soundId] || 'stopped';
      const newState = currentState === 'playing' ? 'paused' : 'playing';
      return {
        ...prev,
        [soundId]: newState
      };
    });
  }, []);

  /**
   * Change the selected variant for a prompt
   * Stops the old variant and plays the new one if something was playing
   */
  const handleVariantChange = useCallback((promptIdx: number, variantIdx: number) => {
    // Group sounds by prompt index
    const soundsByPromptIndex: {[key: number]: any[]} = {};
    generatedSounds.forEach(sound => {
      const idx = sound.prompt_index ?? 0;
      if (!soundsByPromptIndex[idx]) {
        soundsByPromptIndex[idx] = [];
      }
      soundsByPromptIndex[idx].push(sound);
    });

    const sounds = soundsByPromptIndex[promptIdx];
    if (!sounds) return;

    setIndividualSoundStates(prev => {
      const newStates = { ...prev };
      const oldVariantIdx = selectedVariants[promptIdx] || 0;
      const oldSound = sounds[oldVariantIdx];
      const newSound = sounds[variantIdx];

      // Check if the old variant was playing
      const wasPlaying = oldSound && newStates[oldSound.id] === 'playing';

      // Stop all variants of this prompt
      sounds.forEach(sound => {
        newStates[sound.id] = 'stopped';
      });

      // If old variant was playing, start the new variant
      if (wasPlaying && newSound) {
        newStates[newSound.id] = 'playing';
      }

      return newStates;
    });

    // Update selected variant
    setSelectedVariants(prev => ({ ...prev, [promptIdx]: variantIdx }));
  }, [generatedSounds, selectedVariants]);

  /**
   * Update volume for a specific sound
   */
  const handleVolumeChange = useCallback((soundId: string, volumeDb: number) => {
    setSoundVolumes(prev => ({ ...prev, [soundId]: volumeDb }));
  }, []);

  /**
   * Update playback interval for a specific sound
   */
  const handleIntervalChange = useCallback((soundId: string, intervalSeconds: number) => {
    setSoundIntervals(prev => ({ ...prev, [soundId]: intervalSeconds }));
  }, []);

  /**
   * Play all sounds (each maintains independent timing with initial random delay)
   */
  const playAll = useCallback(() => {
    setIndividualSoundStates(prev => {
      const newStates = { ...prev };

      // Group sounds by prompt index to get selected variants
      const soundsByPromptIndex: {[key: number]: any[]} = {};
      generatedSounds.forEach(sound => {
        const promptIdx = sound.prompt_index ?? 0;
        if (!soundsByPromptIndex[promptIdx]) {
          soundsByPromptIndex[promptIdx] = [];
        }
        soundsByPromptIndex[promptIdx].push(sound);
      });

      // Set only the selected variant sounds to playing
      // The initial delay will be calculated in ThreeScene based on each sound's interval
      Object.entries(soundsByPromptIndex).forEach(([promptIdxStr, sounds]) => {
        const promptIdx = parseInt(promptIdxStr);
        const selectedIdx = selectedVariants[promptIdx] || 0;
        const selectedSound = sounds[selectedIdx] || sounds[0];
        if (selectedSound) {
          newStates[selectedSound.id] = 'playing';
        }
      });

      return newStates;
    });
  }, [generatedSounds, selectedVariants]);

  /**
   * Pause all currently playing sounds (including all variants)
   */
  const pauseAll = useCallback(() => {
    setIndividualSoundStates(prev => {
      const newStates = { ...prev };
      // Pause ALL sounds in the state, not just generatedSounds
      Object.keys(newStates).forEach(soundId => {
        if (newStates[soundId] === 'playing') {
          newStates[soundId] = 'paused';
        }
      });
      return newStates;
    });
  }, []);

  /**
   * Stop all sounds (including all variants)
   */
  const stopAll = useCallback(() => {
    setIndividualSoundStates(prev => {
      const newStates = { ...prev };
      // Stop ALL sounds in the state, not just generatedSounds
      Object.keys(newStates).forEach(soundId => {
        newStates[soundId] = 'stopped';
      });
      return newStates;
    });
  }, []);

  /**
   * Check if any sound is currently playing
   */
  const isAnyPlaying = useCallback(() => {
    return Object.values(individualSoundStates).some(state => state === 'playing');
  }, [individualSoundStates]);

  return {
    individualSoundStates,
    selectedVariants,
    soundVolumes,
    soundIntervals,
    toggleSound,
    handleVariantChange,
    handleVolumeChange,
    handleIntervalChange,
    playAll,
    pauseAll,
    stopAll,
    isAnyPlaying
  };
}
