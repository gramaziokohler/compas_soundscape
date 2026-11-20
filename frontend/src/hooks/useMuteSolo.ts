'use client';

import { useMemo } from 'react';
import { useAudioControlsStore, useSoundscapeStore, useUIStore } from '@/store';
import {
  computeMuteSolo,
  isTrackMuted,
  isTrackSoloed,
  soundsInActiveScene,
  type MuteSoloSound,
  type MuteSoloState,
} from '@/lib/audio/utils/mute-solo';

export interface UseMuteSoloResult {
  /** Derived state for the active sound scene (see computeMuteSolo). */
  state: MuteSoloState;
  /** Generated sounds of the active sound scene (the mute/solo scope). */
  sceneSounds: MuteSoloSound[];
  /** DAW "M" button state for the track of `soundId`. */
  isMuted: (soundId: string) => boolean;
  /** DAW "S" button state for the track of `soundId`. */
  isSoloed: (soundId: string) => boolean;
  /** Whether `soundId` is silent (muted, or soloed out). Drives every dimmed look. */
  isSilenced: (soundId: string) => boolean;
  /** Whether a prompt's track is silent (spheres and cards are keyed by prompt). */
  isPromptSilenced: (promptIndex: number) => boolean;
}

/**
 * The single read path for mute/solo in React. Every component that shows a
 * muted / soloed / dimmed look reads it here, scoped to the active sound scene,
 * so what is shown always matches what useSpeckleAudioSync makes the audio
 * engine play.
 *
 * Usage:
 * ```tsx
 * const muteSolo = useMuteSolo();
 * <DAWTrackHead isMuted={muteSolo.isMuted(sound.id)} ... />
 * ```
 */
export function useMuteSolo(): UseMuteSoloResult {
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSounds = useAudioControlsStore((s) => s.soloedSounds);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds) as MuteSoloSound[];
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);

  return useMemo(() => {
    const sceneSounds = soundsInActiveScene(generatedSounds ?? [], soundConfigs, activeSoundParentIndex);
    const state = computeMuteSolo(sceneSounds, mutedSounds, soloedSounds);
    return {
      state,
      sceneSounds,
      isMuted: (soundId) => isTrackMuted(state, soundId),
      isSoloed: (soundId) => isTrackSoloed(state, soundId),
      isSilenced: (soundId) => state.silencedIds.has(soundId),
      isPromptSilenced: (promptIndex) => state.silencedPrompts.has(promptIndex),
    };
  }, [generatedSounds, soundConfigs, activeSoundParentIndex, mutedSounds, soloedSounds]);
}
