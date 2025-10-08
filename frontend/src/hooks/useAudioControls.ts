import { useState, useCallback } from "react";
import { SoundState } from "@/types";

export function useAudioControls(generatedSounds: any[]) {
  const [soundscapeState, setSoundscapeState] = useState<SoundState>('stopped');
  const [individualSoundStates, setIndividualSoundStates] = useState<{[key: string]: SoundState}>({});
  const [selectedVariants, setSelectedVariants] = useState<{[key: number]: number}>({});

  const toggleSound = useCallback((soundId: string) => {
    const currentState = individualSoundStates[soundId] || 'stopped';
    const newState = currentState === 'playing' ? 'paused' : 'playing';
    setIndividualSoundStates(prev => ({
      ...prev,
      [soundId]: newState
    }));
  }, [individualSoundStates]);

  const handleVariantChange = useCallback((promptIdx: number, variantIdx: number) => {
    setSelectedVariants(prev => ({ ...prev, [promptIdx]: variantIdx }));
  }, []);

  const playAll = useCallback(() => {
    setSoundscapeState('playing');
    const newStates: {[key: string]: SoundState} = {};

    const soundsByPromptIndex: {[key: number]: any[]} = {};
    generatedSounds.forEach(sound => {
      const promptIdx = sound.prompt_index ?? 0;
      if (!soundsByPromptIndex[promptIdx]) {
        soundsByPromptIndex[promptIdx] = [];
      }
      soundsByPromptIndex[promptIdx].push(sound);
    });

    Object.entries(soundsByPromptIndex).forEach(([promptIdxStr, sounds]) => {
      const promptIdx = parseInt(promptIdxStr);
      const selectedIdx = selectedVariants[promptIdx] || 0;
      const selectedSound = sounds[selectedIdx] || sounds[0];
      if (selectedSound) {
        newStates[selectedSound.id] = 'playing';
      }
    });

    setIndividualSoundStates(newStates);
  }, [generatedSounds, selectedVariants]);

  const pauseAll = useCallback(() => {
    setSoundscapeState('paused');
    const newStates: {[key: string]: SoundState} = {};
    generatedSounds.forEach(sound => {
      newStates[sound.id] = 'paused';
    });
    setIndividualSoundStates(newStates);
  }, [generatedSounds]);

  const stopAll = useCallback(() => {
    setSoundscapeState('stopped');
    const newStates: {[key: string]: SoundState} = {};
    generatedSounds.forEach(sound => {
      newStates[sound.id] = 'stopped';
    });
    setIndividualSoundStates(newStates);
  }, [generatedSounds]);

  return {
    soundscapeState,
    individualSoundStates,
    selectedVariants,
    toggleSound,
    handleVariantChange,
    playAll,
    pauseAll,
    stopAll,
    setSoundscapeState
  };
}
