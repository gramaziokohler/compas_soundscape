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
  
  // Mute and Solo state
  const [mutedSounds, setMutedSounds] = useState<Set<string>>(new Set());
  const [soloedSound, setSoloedSound] = useState<string | null>(null);

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
   * Toggle mute state for a specific sound
   * Does not affect playback scheduling, only audio output
   * If solo is active for this sound, deactivate solo first
   */
  const handleMute = useCallback((soundId: string) => {
    // If this sound is soloed, un-solo it first
    setSoloedSound(prev => prev === soundId ? null : prev);
    
    setMutedSounds(prev => {
      const newMuted = new Set(prev);
      if (newMuted.has(soundId)) {
        newMuted.delete(soundId);
      } else {
        newMuted.add(soundId);
      }
      return newMuted;
    });
  }, []);

  /**
   * Toggle solo state for a specific sound
   * When solo is active, all other sounds are effectively muted
   * If this sound is muted, unmute it when soloing
   */
  const handleSolo = useCallback((soundId: string) => {
    // If this sound is muted, unmute it
    setMutedSounds(prev => {
      const newMuted = new Set(prev);
      newMuted.delete(soundId);
      return newMuted;
    });
    
    setSoloedSound(prev => prev === soundId ? null : soundId);
  }, []);

  /**
   * Play all sounds (each maintains independent timing with initial random delay)
   */
  const playAll = useCallback(() => {
    console.log('[Audio Controls] Play All requested');
    console.log(`[Audio Controls] Total sounds available: ${generatedSounds.length}`);
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

        // For uploaded/library sounds (total_copies = 1), just play them directly
        if (sounds.length === 1 && sounds[0].total_copies === 1) {
          const displayName = sounds[0].display_name || sounds[0].id;
          newStates[sounds[0].id] = 'playing';
        } else {
          // For generated sounds with variants, play the selected variant
          const selectedIdx = selectedVariants[promptIdx] || 0;
          const selectedSound = sounds[selectedIdx] || sounds[0];
          if (selectedSound) {
            const displayName = selectedSound.display_name || selectedSound.id;
            newStates[selectedSound.id] = 'playing';
          }
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
   *
   * IMPORTANT: Sets ALL sound states to 'stopped'.
   * The ThreeScene effect will detect these state changes and stop the audio.
   */
  const stopAll = useCallback(() => {
    // Count how many sounds are actually playing or paused before stopping
    const soundsToStop = generatedSounds.filter(sound => {
      const state = individualSoundStates[sound.id];
      return state === 'playing' || state === 'paused';
    });

    // Only log if there are sounds to stop
    if (soundsToStop.length > 0) {
      console.log('[Audio Controls] Stop All requested');
      console.log(`[Audio Controls] Stopping ${soundsToStop.length} sound(s)`);
    }

    setIndividualSoundStates(prev => {
      const newStates = { ...prev };
      // Stop ALL sounds in the state, not just generatedSounds
      // Also ensure we add any sounds that might not be in state yet
      generatedSounds.forEach(sound => {
        const prevState = newStates[sound.id];
        // Only log if state is actually changing
        if (prevState && prevState !== 'stopped') {
          const displayName = sound.display_name || sound.id;
          console.log(`[Audio Controls] Stopping ${displayName}: ${prevState} -> stopped`);
        }
        newStates[sound.id] = 'stopped';
      });
      return newStates;
    });
  }, [generatedSounds, individualSoundStates]);

  /**
   * Check if any sound is currently playing
   */
  const isAnyPlaying = useCallback(() => {
    return Object.values(individualSoundStates).some(state => state === 'playing');
  }, [individualSoundStates]);

  /**
   * Force stop all audio - robust method that clears all state
   * This method is more aggressive than stopAll and ensures everything is killed
   */
  const forceStopAll = useCallback(() => {
    setIndividualSoundStates({});
    setSoundVolumes({});
    setSoundIntervals({});
  }, []);

  return {
    individualSoundStates,
    selectedVariants,
    soundVolumes,
    soundIntervals,
    mutedSounds,
    soloedSound,
    toggleSound,
    handleVariantChange,
    handleVolumeChange,
    handleIntervalChange,
    handleMute,
    handleSolo,
    playAll,
    pauseAll,
    stopAll,
    isAnyPlaying,
    forceStopAll
  };
}
