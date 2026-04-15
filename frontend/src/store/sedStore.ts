/**
 * SED Store (Sound Event Detection)
 *
 * Replaces useSED. Manages SED analysis state: audio info, detected sounds,
 * analysis options, and progress. Participates in undo/redo so the detected
 * sounds list (which may drive sound generation) can be undone.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type { SEDAudioInfo, DetectedSound, SEDAnalysisOptions } from '@/types';
import { loadAudioFileWithBuffer } from '@/lib/audio/utils/audio-info';
import { API_BASE_URL, DEFAULT_SPL_DB, DEFAULT_DIFFUSION_STEPS, LLM_SUGGESTED_INTERVAL_SECONDS, DEFAULT_DURATION_SECONDS } from '@/utils/constants';

// ─── Partialize ───────────────────────────────────────────────────────────────

export const sedPartialize = (state: SEDStoreState) => ({
  sedDetectedSounds: state.sedDetectedSounds,
  sedAnalysisOptions: { ...state.sedAnalysisOptions },
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface SEDStoreState {
  isSEDAnalyzing: boolean;
  sedAudioInfo: SEDAudioInfo | null;
  sedAudioBuffer: AudioBuffer | null;
  sedDetectedSounds: DetectedSound[];
  sedError: string | null;
  sedProgress: string;
  sedAnalysisOptions: SEDAnalysisOptions;

  loadAudioInfo: (file: File) => Promise<void>;
  analyzeSoundEvents: (file: File, numSounds: number) => Promise<void>;
  setSedAnalysisOptions: (opts: Partial<SEDAnalysisOptions>) => void;
  toggleSEDOption: (option: keyof SEDAnalysisOptions, value: boolean) => void;
  clearSEDResults: () => void;
  formatForSoundGeneration: () => any[];
  resetSED: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSEDStore = create<SEDStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        isSEDAnalyzing: false,
        sedAudioInfo: null,
        sedAudioBuffer: null,
        sedDetectedSounds: [],
        sedError: null,
        sedProgress: '',
        sedAnalysisOptions: {
          analyze_amplitudes: true,
          analyze_durations: true,
          analyze_frequencies: false,
        },

        loadAudioInfo: async (file) => {
          set({ sedError: null }, false, 'sed/loadAudioInfoStart');
          try {
            const result = await loadAudioFileWithBuffer(file);
            if (result) {
              set(
                { sedAudioInfo: result.audioInfo, sedAudioBuffer: result.audioBuffer },
                false,
                'sed/loadAudioInfoDone',
              );
            } else {
              set({ sedError: 'Failed to load audio file info' }, false, 'sed/loadAudioInfoFail');
            }
          } catch {
            set({ sedError: 'Failed to read audio file' }, false, 'sed/loadAudioInfoError');
          }
        },

        analyzeSoundEvents: async (file, numSounds) => {
          set(
            { isSEDAnalyzing: true, sedError: null, sedProgress: 'Uploading audio file...' },
            false,
            'sed/analyzeStart',
          );
          try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('num_sounds', String(numSounds));
            formData.append('analyze_amplitudes', String(get().sedAnalysisOptions.analyze_amplitudes));
            formData.append('analyze_durations', String(get().sedAnalysisOptions.analyze_durations));
            formData.append('analyze_frequencies', String(get().sedAnalysisOptions.analyze_frequencies));

            set({ sedProgress: 'Analyzing sound events with YAMNet...' }, false, 'sed/analyzing');

            const response = await fetch(`${API_BASE_URL}/api/analyze-audio`, {
              method: 'POST',
              body: formData,
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.detail || 'SED analysis failed');
            }

            const result = await response.json();
            set(
              {
                sedDetectedSounds: result.detected_sounds || [],
                isSEDAnalyzing: false,
                sedProgress: 'Analysis complete!',
              },
              false,
              'sed/analyzeDone',
            );

            setTimeout(() => {
              set({ sedProgress: '' }, false, 'sed/clearProgress');
            }, 2000);
          } catch (err: any) {
            set(
              {
                isSEDAnalyzing: false,
                sedError: err.message || 'SED analysis failed',
                sedProgress: '',
              },
              false,
              'sed/analyzeError',
            );
          }
        },

        setSedAnalysisOptions: (opts) =>
          set(
            (s) => ({ sedAnalysisOptions: { ...s.sedAnalysisOptions, ...opts } }),
            false,
            'sed/setOptions',
          ),

        formatForSoundGeneration: () => {
          const { sedDetectedSounds } = get();
          return sedDetectedSounds.map((sound) => ({
            prompt: sound.label,
            duration: sound.duration ?? DEFAULT_DURATION_SECONDS,
            guidance_scale: 3.5,
            negative_prompt: '',
            seed_copies: 1,
            steps: DEFAULT_DIFFUSION_STEPS,
            type: 'text-to-audio',
            spl_db: DEFAULT_SPL_DB,
            interval_seconds: sound.interval_seconds ?? LLM_SUGGESTED_INTERVAL_SECONDS,
          }));
        },

        resetSED: () =>
          set(
            {
              isSEDAnalyzing: false,
              sedAudioInfo: null,
              sedAudioBuffer: null,
              sedDetectedSounds: [],
              sedError: null,
              sedProgress: '',
            },
            false,
            'sed/reset',
          ),

        clearSEDResults: () =>
          set(
            { sedAudioInfo: null, sedAudioBuffer: null, sedDetectedSounds: [], sedError: null, sedProgress: '' },
            false,
            'sed/clearResults',
          ),

        toggleSEDOption: (option, value) =>
          set(
            (s) => ({ sedAnalysisOptions: { ...s.sedAnalysisOptions, [option]: value } }),
            false,
            'sed/toggleOption',
          ),
      }),
      { name: 'sedStore' },
    ),
    { partialize: sedPartialize },
  ),
);
