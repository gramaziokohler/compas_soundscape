/**
 * Modal Impact Synthesis Hook
 * 
 * React hook for performing modal analysis and synthesizing impact sounds
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiService } from '@/services/api';
import { ModalImpactSynthesizer } from '@/lib/audio/modal-impact-synthesis';
import { IMPACT_SOUND } from '@/lib/constants';
import type {
  ModalAnalysisRequest,
  ModalAnalysisResult,
  ImpactParameters,
  ModalAnalysisState,
  ImpactSynthesisState,
  ModeVisualizationState,
} from '@/types/modal';

interface UseModalImpactReturn {
  // Modal Analysis
  modalState: ModalAnalysisState;
  analyzeModal: (request: ModalAnalysisRequest) => Promise<void>;
  clearModalAnalysis: () => void;

  // Impact Synthesis
  impactState: ImpactSynthesisState;
  synthesizeImpact: (impactParams: ImpactParameters) => Promise<void>;
  playImpact: () => void;
  stopImpact: () => void;
  clearImpact: () => void;

  // Mode Visualization
  visualizationState: ModeVisualizationState;
  setModeVisualization: (active: boolean) => void;
  selectMode: (modeIndex: number | null) => void;

  // Quick Actions
  analyzeAndSynthesize: (
    request: ModalAnalysisRequest,
    impactParams: ImpactParameters
  ) => Promise<void>;
}

/**
 * Hook for modal analysis and impact sound synthesis
 */
export function useModalImpact(): UseModalImpactReturn {
  // Modal Analysis State
  const [modalState, setModalState] = useState<ModalAnalysisState>({
    isAnalyzing: false,
    result: null,
    error: null,
  });

  // Impact Synthesis State
  const [impactState, setImpactState] = useState<ImpactSynthesisState>({
    isSynthesizing: false,
    audioBuffer: null,
    isPlaying: false,
    error: null,
  });

  // Mode Visualization State
  const [visualizationState, setVisualizationState] = useState<ModeVisualizationState>({
    isActive: false,
    selectedModeIndex: null,
  });

  // Refs
  const synthesizerRef = useRef<ModalImpactSynthesizer | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize synthesizer
  useEffect(() => {
    synthesizerRef.current = new ModalImpactSynthesizer();

    return () => {
      // Cleanup: stop any playing sounds
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop();
        } catch (e) {
          // Already stopped
        }
      }
    };
  }, []);

  /**
   * Perform modal analysis on a mesh
   */
  const analyzeModal = useCallback(async (request: ModalAnalysisRequest) => {
    setModalState({
      isAnalyzing: true,
      result: null,
      error: null,
    });

    try {
      const result = await apiService.analyzeModal(request);

      setModalState({
        isAnalyzing: false,
        result,
        error: null,
      });

      console.log('[ModalImpact] Analysis complete:', {
        modes: result.num_modes_computed,
        frequencies: result.frequencies.slice(0, 5),
        fundamental: result.frequency_response?.fundamental_frequency,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Modal analysis failed';
      
      setModalState({
        isAnalyzing: false,
        result: null,
        error: errorMessage,
      });

      console.error('[ModalImpact] Analysis failed:', error);
      throw error;
    }
  }, []);

  /**
   * Clear modal analysis results
   */
  const clearModalAnalysis = useCallback(() => {
    setModalState({
      isAnalyzing: false,
      result: null,
      error: null,
    });
  }, []);

  /**
   * Synthesize impact sound from modal analysis result
   */
  const synthesizeImpact = useCallback(
    async (impactParams: ImpactParameters) => {
      if (!modalState.result) {
        throw new Error('No modal analysis result available. Analyze mesh first.');
      }

      if (!synthesizerRef.current) {
        throw new Error('Synthesizer not initialized');
      }

      setImpactState((prev) => ({
        ...prev,
        isSynthesizing: true,
        error: null,
      }));

      try {
        const audioBuffer = await synthesizerRef.current.synthesizeImpact(
          modalState.result,
          impactParams
        );

        setImpactState({
          isSynthesizing: false,
          audioBuffer,
          isPlaying: false,
          error: null,
        });

        console.log('[ModalImpact] Synthesis complete:', {
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          modes: modalState.result.num_modes_computed,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Synthesis failed';

        setImpactState((prev) => ({
          ...prev,
          isSynthesizing: false,
          error: errorMessage,
        }));

        console.error('[ModalImpact] Synthesis failed:', error);
        throw error;
      }
    },
    [modalState.result]
  );

  /**
   * Play the synthesized impact sound
   */
  const playImpact = useCallback(() => {
    if (!impactState.audioBuffer || !synthesizerRef.current) {
      console.warn('[ModalImpact] No audio buffer to play');
      return;
    }

    // Stop any currently playing sound
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Already stopped
      }
    }

    // Play the buffer
    const source = synthesizerRef.current.playBuffer(impactState.audioBuffer);
    audioSourceRef.current = source;

    setImpactState((prev) => ({
      ...prev,
      isPlaying: true,
    }));

    // Update state when playback ends
    source.onended = () => {
      setImpactState((prev) => ({
        ...prev,
        isPlaying: false,
      }));
      audioSourceRef.current = null;
    };

    console.log('[ModalImpact] Playing impact sound');
  }, [impactState.audioBuffer]);

  /**
   * Stop the currently playing impact sound
   */
  const stopImpact = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
        audioSourceRef.current = null;
        
        setImpactState((prev) => ({
          ...prev,
          isPlaying: false,
        }));

        console.log('[ModalImpact] Stopped impact sound');
      } catch (e) {
        // Already stopped
      }
    }
  }, []);

  /**
   * Clear synthesized impact sound
   */
  const clearImpact = useCallback(() => {
    stopImpact();
    
    setImpactState({
      isSynthesizing: false,
      audioBuffer: null,
      isPlaying: false,
      error: null,
    });
  }, [stopImpact]);

  /**
   * Perform modal analysis and synthesize impact in one go
   */
  const analyzeAndSynthesize = useCallback(
    async (
      request: ModalAnalysisRequest,
      impactParams: ImpactParameters
    ) => {
      // Step 1: Analyze
      await analyzeModal(request);

      // Step 2: Synthesize (will use the newly analyzed result)
      // Wait a tick for state to update
      await new Promise((resolve) => setTimeout(resolve, 0));

      await synthesizeImpact(impactParams);
    },
    [analyzeModal, synthesizeImpact]
  );

  /**
   * Enable or disable mode visualization
   */
  const setModeVisualization = useCallback((active: boolean) => {
    setVisualizationState((prev) => ({
      ...prev,
      isActive: active,
      selectedModeIndex: active ? prev.selectedModeIndex || 0 : null,
    }));
  }, []);

  /**
   * Select a specific mode to visualize (shows nodal lines)
   */
  const selectMode = useCallback((modeIndex: number | null) => {
    setVisualizationState((prev) => ({
      ...prev,
      selectedModeIndex: modeIndex,
      isActive: modeIndex !== null,
    }));
  }, []);

  return {
    // Modal Analysis
    modalState,
    analyzeModal,
    clearModalAnalysis,

    // Impact Synthesis
    impactState,
    synthesizeImpact,
    playImpact,
    stopImpact,
    clearImpact,

    // Mode Visualization
    visualizationState,
    setModeVisualization,
    selectMode,

    // Quick Actions
    analyzeAndSynthesize,
  };
}

/**
 * Helper: Create impact parameters from a point in 3D space
 */
export function createImpactParameters(
  x: number,
  y: number,
  z: number,
  velocity: number = 5.0,
  material?: string
): ImpactParameters {
  return {
    position: { x, y, z },
    velocity: Math.max(0.1, Math.min(10, velocity)), // Clamp to [0.1, 10]
    dampingRatio: material
      ? IMPACT_SOUND.DAMPING_RATIOS[material as keyof typeof IMPACT_SOUND.DAMPING_RATIOS]
      : undefined,
    duration: IMPACT_SOUND.DEFAULT_DURATION,
    material,
  };
}
