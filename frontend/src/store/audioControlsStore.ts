/**
 * Audio Controls Store
 *
 * Replaces useAudioControls hook. Manages all audio playback state globally so
 * SpeckleScene, SoundGenerationSection, WaveSurferTimeline, and EntityInfoPanel
 * can all read from one source of truth without prop drilling through page.tsx.
 *
 * Sync:  page.tsx must call syncGeneratedSounds() whenever soundGen.generatedSounds
 *        changes so that playAll / stopAll / handleVariantChange / handleIntervalChange
 *        have the correct sound list available.
 *
 * zundo partializes on: soundVolumes, soundIntervals, selectedVariants, mutedSounds,
 *                       soloedSound  (the "user-facing" config — excludes play state).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type { SoundState } from '@/types';
import { AUDIO_PLAYBACK } from '@/utils/constants';

export interface AudioControlsStoreState {
  // ── State ──
  individualSoundStates: Record<string, SoundState>;
  selectedVariants: Record<number, number>;
  soundVolumes: Record<string, number>;
  soundIntervals: Record<string, number>;
  soundTrims: Record<string, { start: number; end: number }>;
  mutedSounds: Set<string>;
  soloedSound: string | null;
  previewingSoundId: string | null;
  /** Absolute jitter applied to each iteration's playback interval (seconds). */
  intervalJitterSeconds: number;
  /** Internal: synced from useSoundGeneration. Used by playAll / stopAll / handleVariantChange. */
  _generatedSounds: any[];

  // ── Sync ──
  syncGeneratedSounds: (sounds: any[]) => void;

  // ── Actions ──
  toggleSound: (soundId: string) => void;
  handleVariantChange: (promptIdx: number, variantIdx: number) => void;
  handleVolumeChange: (soundId: string, volumeDb: number) => void;
  handleIntervalChange: (soundId: string, intervalSeconds: number) => void;
  handleMute: (soundId: string) => void;
  handleSolo: (soundId: string) => void;
  setSoundTrim: (soundId: string, trim: { start: number; end: number }) => void;
  setIntervalJitter: (seconds: number) => void;
  handlePreviewPlayPause: (soundId: string) => void;
  handlePreviewStop: (soundId: string) => void;
  stopSoundcardPreview: () => void;
  playAll: () => void;
  pauseAll: () => void;
  stopAll: () => void;
  isAnyPlaying: () => boolean;
  forceStopAll: () => void;
  restoreVolumeAndIntervals: (
    volumes: Record<string, number>,
    intervals: Record<string, number>,
  ) => void;
}

// ─── Partialize (exported for snapshot registry) ───────────────────────────

export const audioControlsPartialize = (state: AudioControlsStoreState) => ({
  soundVolumes: { ...state.soundVolumes },
  soundIntervals: { ...state.soundIntervals },
  soundTrims: { ...state.soundTrims },
  selectedVariants: { ...state.selectedVariants },
  mutedSounds: new Set(state.mutedSounds),
  soloedSound: state.soloedSound,
  intervalJitterSeconds: state.intervalJitterSeconds,
});

export const useAudioControlsStore = create<AudioControlsStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        // ── Initial state ──
        individualSoundStates: {},
        selectedVariants: {},
        soundVolumes: {},
        soundIntervals: {},
        soundTrims: {},
        mutedSounds: new Set(),
        soloedSound: null,
        previewingSoundId: null,
        intervalJitterSeconds: AUDIO_PLAYBACK.DEFAULT_INTERVAL_JITTER_SECONDS,
        _generatedSounds: [],

        // ── Sync ──
        syncGeneratedSounds: (sounds) =>
          set({ _generatedSounds: sounds }, false, 'audio/syncGeneratedSounds'),

        // ── Actions ──
        toggleSound: (soundId) =>
          set(
            (state) => {
              const current = state.individualSoundStates[soundId] || 'stopped';
              return {
                individualSoundStates: {
                  ...state.individualSoundStates,
                  [soundId]: current === 'playing' ? 'paused' : 'playing',
                },
              };
            },
            false,
            'audio/toggleSound',
          ),

        handleVariantChange: (promptIdx, variantIdx) => {
          const { _generatedSounds, selectedVariants, previewingSoundId, individualSoundStates } =
            get();

          const byPrompt: Record<number, any[]> = {};
          _generatedSounds.forEach((s) => {
            const idx = s.prompt_index ?? 0;
            if (!byPrompt[idx]) byPrompt[idx] = [];
            byPrompt[idx].push(s);
          });

          const sounds = byPrompt[promptIdx];
          if (!sounds) return;

          const oldVariantIdx = selectedVariants[promptIdx] || 0;
          const oldSound = sounds[oldVariantIdx];
          const newSound = sounds[variantIdx];
          const wasPreviewPlaying = oldSound && previewingSoundId === oldSound.id;

          const newStates = { ...individualSoundStates };
          const wasTimelinePlaying = Boolean(oldSound && newStates[oldSound.id] === 'playing');
          sounds.forEach((s) => { newStates[s.id] = 'stopped'; });
          if (wasTimelinePlaying && newSound) newStates[newSound.id] = 'playing';

          set(
            {
              individualSoundStates: newStates,
              selectedVariants: { ...selectedVariants, [promptIdx]: variantIdx },
              previewingSoundId:
                wasPreviewPlaying && newSound ? newSound.id : previewingSoundId,
            },
            false,
            'audio/handleVariantChange',
          );
        },

        handleVolumeChange: (soundId, volumeDb) =>
          set(
            (state) => ({ soundVolumes: { ...state.soundVolumes, [soundId]: volumeDb } }),
            false,
            'audio/handleVolumeChange',
          ),

        handleIntervalChange: (soundId, intervalSeconds) => {
          get().stopAll();
          set(
            (state) => ({
              soundIntervals: { ...state.soundIntervals, [soundId]: intervalSeconds },
            }),
            false,
            'audio/handleIntervalChange',
          );
        },

        handleMute: (soundId) =>
          set(
            (state) => {
              const newMuted = new Set(state.mutedSounds);
              newMuted.has(soundId) ? newMuted.delete(soundId) : newMuted.add(soundId);
              return {
                mutedSounds: newMuted,
                soloedSound: state.soloedSound === soundId ? null : state.soloedSound,
              };
            },
            false,
            'audio/handleMute',
          ),

        handleSolo: (soundId) =>
          set(
            (state) => {
              const newMuted = new Set(state.mutedSounds);
              newMuted.delete(soundId);
              return {
                mutedSounds: newMuted,
                soloedSound: state.soloedSound === soundId ? null : soundId,
              };
            },
            false,
            'audio/handleSolo',
          ),

        setSoundTrim: (soundId, trim) =>
          set(
            (state) => ({ soundTrims: { ...state.soundTrims, [soundId]: trim } }),
            false,
            'audio/setSoundTrim',
          ),

        setIntervalJitter: (seconds) =>
          set({ intervalJitterSeconds: seconds }, false, 'audio/setIntervalJitter'),

        handlePreviewPlayPause: (soundId) => {
          const { individualSoundStates } = get();
          if (Object.values(individualSoundStates).some((s) => s === 'playing')) {
            const stopped: Record<string, SoundState> = {};
            Object.keys(individualSoundStates).forEach((id) => { stopped[id] = 'stopped'; });
            set({ individualSoundStates: stopped }, false, 'audio/previewStopTimeline');
          }
          set(
            (state) => ({
              previewingSoundId:
                state.previewingSoundId === soundId ? null : soundId,
            }),
            false,
            'audio/handlePreviewPlayPause',
          );
        },

        handlePreviewStop: (soundId) =>
          set(
            (state) => ({
              previewingSoundId:
                state.previewingSoundId === soundId ? null : state.previewingSoundId,
            }),
            false,
            'audio/handlePreviewStop',
          ),

        stopSoundcardPreview: () =>
          set({ previewingSoundId: null }, false, 'audio/stopSoundcardPreview'),

        playAll: () => {
          const { _generatedSounds, selectedVariants } = get();
          set({ previewingSoundId: null }, false, 'audio/playAll/clearPreview');

          const byPrompt: Record<number, any[]> = {};
          _generatedSounds.forEach((s) => {
            const idx = s.prompt_index ?? 0;
            if (!byPrompt[idx]) byPrompt[idx] = [];
            byPrompt[idx].push(s);
          });

          set(
            (state) => {
              const newStates = { ...state.individualSoundStates };
              Object.entries(byPrompt).forEach(([promptIdxStr, sounds]) => {
                const promptIdx = parseInt(promptIdxStr);
                if (sounds.length === 1 && sounds[0].total_copies === 1) {
                  newStates[sounds[0].id] = 'playing';
                } else {
                  const selectedIdx = selectedVariants[promptIdx] || 0;
                  const sel = sounds[selectedIdx] || sounds[0];
                  if (sel) newStates[sel.id] = 'playing';
                }
              });
              return { individualSoundStates: newStates };
            },
            false,
            'audio/playAll',
          );
        },

        pauseAll: () =>
          set(
            (state) => {
              const newStates = { ...state.individualSoundStates };
              Object.keys(newStates).forEach((id) => {
                if (newStates[id] === 'playing') newStates[id] = 'paused';
              });
              return { individualSoundStates: newStates };
            },
            false,
            'audio/pauseAll',
          ),

        stopAll: () => {
          const { _generatedSounds } = get();
          set(
            (state) => {
              const newStates = { ...state.individualSoundStates };
              _generatedSounds.forEach((s) => { newStates[s.id] = 'stopped'; });
              return { individualSoundStates: newStates };
            },
            false,
            'audio/stopAll',
          );
        },

        isAnyPlaying: () =>
          Object.values(get().individualSoundStates).some((s) => s === 'playing'),

        forceStopAll: () =>
          set(
            { individualSoundStates: {}, soundVolumes: {}, soundIntervals: {} },
            false,
            'audio/forceStopAll',
          ),

        restoreVolumeAndIntervals: (volumes, intervals) =>
          set(
            { soundVolumes: volumes, soundIntervals: intervals },
            false,
            'audio/restoreVolumeAndIntervals',
          ),
      }),
      { name: 'AudioControlsStore' },
    ),
    {
      // Only record history for user-facing config (not play state / internal)
      partialize: audioControlsPartialize,
      equality: (past, current) =>
        JSON.stringify(past.soundVolumes) === JSON.stringify(current.soundVolumes) &&
        JSON.stringify(past.soundIntervals) === JSON.stringify(current.soundIntervals) &&
        JSON.stringify(past.soundTrims) === JSON.stringify(current.soundTrims) &&
        JSON.stringify(past.selectedVariants) === JSON.stringify(current.selectedVariants) &&
        past.mutedSounds.size === current.mutedSounds.size &&
        [...past.mutedSounds].every((id) => current.mutedSounds.has(id)) &&
        past.soloedSound === current.soloedSound &&
        past.intervalJitterSeconds === current.intervalJitterSeconds,
    },
  ),
);
