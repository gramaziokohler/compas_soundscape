/**
 * Modal Impact Store
 *
 * Replaces useModalImpact. Manages modal analysis and impact sound synthesis.
 *
 * ModalImpactSynthesizer and AudioBufferSourceNode are not serializable, so
 * they live as module-level refs. The store holds only the serializable/
 * displayable parts of the state.
 *
 * zundo partializes on the modal analysis result (the key "user intent" data).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { ModalImpactSynthesizer } from '@/lib/audio/modal-impact-synthesis';
import { IMPACT_SOUND } from '@/utils/constants';
import type {
  ModalAnalysisRequest,
  ModalAnalysisResult,
  ImpactParameters,
  ModalAnalysisState,
  ImpactSynthesisState,
  ModeVisualizationState,
} from '@/types/modal';

// ─── Module-level audio refs (non-serializable) ───────────────────────────────
let _synthesizer: ModalImpactSynthesizer | null = null;
let _audioSource: AudioBufferSourceNode | null = null;

function getSynthesizer(): ModalImpactSynthesizer {
  if (!_synthesizer) _synthesizer = new ModalImpactSynthesizer();
  return _synthesizer;
}

// ─── Partialize ───────────────────────────────────────────────────────────────

export const modalImpactPartialize = (state: ModalImpactStoreState) => ({
  modalState: {
    isAnalyzing: state.modalState.isAnalyzing,
    result: state.modalState.result,
    error: state.modalState.error,
  },
});

// ─── State ────────────────────────────────────────────────────────────────────

export interface ModalImpactStoreState {
  modalState: ModalAnalysisState;
  /** audioBuffer is not serializable — held in state for local session use only. */
  impactState: ImpactSynthesisState;
  visualizationState: ModeVisualizationState;

  analyzeModal: (request: ModalAnalysisRequest) => Promise<void>;
  clearModalAnalysis: () => void;

  synthesizeImpact: (impactParams: ImpactParameters) => Promise<void>;
  playImpact: () => void;
  stopImpact: () => void;
  clearImpact: () => void;

  setModeVisualization: (active: boolean) => void;
  selectMode: (modeIndex: number | null) => void;

  analyzeAndSynthesize: (
    request: ModalAnalysisRequest,
    impactParams: ImpactParameters,
  ) => Promise<void>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useModalImpactStore = create<ModalImpactStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        modalState: { isAnalyzing: false, result: null, error: null },
        impactState: { isSynthesizing: false, audioBuffer: null, isPlaying: false, error: null },
        visualizationState: { isActive: false, selectedModeIndex: null },

        analyzeModal: async (request) => {
          set(
            { modalState: { isAnalyzing: true, result: null, error: null } },
            false,
            'modalImpact/analyzeStart',
          );
          try {
            const result = await apiService.analyzeModal(request);
            set(
              { modalState: { isAnalyzing: false, result, error: null } },
              false,
              'modalImpact/analyzeDone',
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Modal analysis failed';
            set(
              { modalState: { isAnalyzing: false, result: null, error: errorMessage } },
              false,
              'modalImpact/analyzeError',
            );
            throw error;
          }
        },

        clearModalAnalysis: () =>
          set(
            { modalState: { isAnalyzing: false, result: null, error: null } },
            false,
            'modalImpact/clearAnalysis',
          ),

        synthesizeImpact: async (impactParams) => {
          const { modalState } = get();
          if (!modalState.result) throw new Error('No modal analysis result available.');

          set(
            (s) => ({ impactState: { ...s.impactState, isSynthesizing: true, error: null } }),
            false,
            'modalImpact/synthesizeStart',
          );
          try {
            const synth = getSynthesizer();
            const audioBuffer = await synth.synthesizeImpact(modalState.result, impactParams);
            set(
              {
                impactState: {
                  isSynthesizing: false,
                  audioBuffer,
                  isPlaying: false,
                  error: null,
                },
              },
              false,
              'modalImpact/synthesizeDone',
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Synthesis failed';
            set(
              (s) => ({
                impactState: { ...s.impactState, isSynthesizing: false, error: errorMessage },
              }),
              false,
              'modalImpact/synthesizeError',
            );
            throw error;
          }
        },

        playImpact: () => {
          const { impactState } = get();
          if (!impactState.audioBuffer) {
            console.warn('[modalImpactStore] No audio buffer to play');
            return;
          }

          // Stop existing playback
          if (_audioSource) {
            try { _audioSource.stop(); } catch {}
          }

          const synth = getSynthesizer();
          const source = synth.playBuffer(impactState.audioBuffer);
          _audioSource = source;

          set(
            (s) => ({ impactState: { ...s.impactState, isPlaying: true } }),
            false,
            'modalImpact/play',
          );

          source.onended = () => {
            _audioSource = null;
            set(
              (s) => ({ impactState: { ...s.impactState, isPlaying: false } }),
              false,
              'modalImpact/playEnded',
            );
          };
        },

        stopImpact: () => {
          if (_audioSource) {
            try { _audioSource.stop(); } catch {}
            _audioSource = null;
          }
          set(
            (s) => ({ impactState: { ...s.impactState, isPlaying: false } }),
            false,
            'modalImpact/stop',
          );
        },

        clearImpact: () => {
          get().stopImpact();
          set(
            {
              impactState: { isSynthesizing: false, audioBuffer: null, isPlaying: false, error: null },
            },
            false,
            'modalImpact/clearImpact',
          );
        },

        setModeVisualization: (active) =>
          set(
            (s) => ({
              visualizationState: {
                ...s.visualizationState,
                isActive: active,
                selectedModeIndex: active ? s.visualizationState.selectedModeIndex ?? 0 : null,
              },
            }),
            false,
            'modalImpact/setVisualization',
          ),

        selectMode: (modeIndex) =>
          set(
            (s) => ({ visualizationState: { ...s.visualizationState, selectedModeIndex: modeIndex } }),
            false,
            'modalImpact/selectMode',
          ),

        analyzeAndSynthesize: async (request, impactParams) => {
          await get().analyzeModal(request);
          await new Promise((resolve) => setTimeout(resolve, 0));
          await get().synthesizeImpact(impactParams);
        },
      }),
      { name: 'modalImpactStore' },
    ),
    { partialize: modalImpactPartialize },
  ),
);
