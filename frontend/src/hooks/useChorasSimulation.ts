/**
 * useChorasSimulation Hook
 * 
 * Manages Choras acoustic simulation workflow with typed state.
 * Handles material selection, simulation execution, progress tracking, and result saving.
 * State persists across tab changes using a module-level singleton.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '@/services/api';
import { useErrorNotification } from '@/contexts/ErrorContext';
import {
  CHORAS_DEFAULT_C0,
  CHORAS_DEFAULT_IR_LENGTH,
  CHORAS_DEFAULT_LC,
  CHORAS_DEFAULT_EDT,
  CHORAS_DEFAULT_SIM_LEN_TYPE,
  CHORAS_POLL_INTERVAL
} from '@/lib/constants';

// Types
export interface ChorasMaterial {
  id: number;
  name: string;
  description?: string;
  category?: string;
}

export interface ChorasSimulationSettings {
  de_c0: number;
  de_ir_length: number;
  de_lc: number;
  edt: number;
  sim_len_type: 'ir_length' | 'edt';
}

export interface ChorasSimulationState {
  materials: ChorasMaterial[];
  selectedMaterialId: number | null;
  simulationSettings: ChorasSimulationSettings;
  isRunning: boolean;
  status: string;
  progress: number;
  currentSimulationId: number | null;
  currentSimulationRunId: number | null;
  error: string | null;
  simulationResults: string | null;
  irImported: boolean;
}

export interface ChorasSimulationMethods {
  loadMaterials: () => Promise<void>;
  setSelectedMaterialId: (id: number) => void;
  updateSimulationSettings: (settings: Partial<ChorasSimulationSettings>) => void;
  runSimulation: (file: File, simulationName: string, receivers: any[], soundscapeData: any[]) => Promise<void>;
  cancelSimulation: () => Promise<void>;
  refreshProgress: () => Promise<void>;
}

// Module-level state singleton to persist across component unmounts/remounts
let persistentState: ChorasSimulationState = {
  materials: [],
  selectedMaterialId: null,
  simulationSettings: {
    de_c0: CHORAS_DEFAULT_C0,
    de_ir_length: CHORAS_DEFAULT_IR_LENGTH,
    de_lc: CHORAS_DEFAULT_LC,
    edt: CHORAS_DEFAULT_EDT,
    sim_len_type: CHORAS_DEFAULT_SIM_LEN_TYPE as 'ir_length' | 'edt'
  },
  isRunning: false,
  status: 'Idle',
  progress: 0,
  currentSimulationId: null,
  currentSimulationRunId: null,
  error: null,
  simulationResults: null,
  irImported: false
};

/**
 * Hook for managing Choras acoustic simulation workflow
 */
export function useChorasSimulation(onIRImported?: () => void) {
  const [state, setState] = useState<ChorasSimulationState>(persistentState);
  const isMounted = useRef(true);
  const { addError } = useErrorNotification();

  // Use ref to hold the latest setState function for progress updates
  const setStateRef = useRef(setState);

  // Keep ref updated with latest setState
  useEffect(() => {
    setStateRef.current = setState;
  }, [setState]);

  // Sync state changes back to persistent storage
  useEffect(() => {
    persistentState = state;
  }, [state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  /**
   * Load available materials from Choras library
   */
  const loadMaterials = useCallback(async () => {
    try {
      const materials = await apiService.getChorasMaterials();
      setState(prev => ({
        ...prev,
        materials,
        selectedMaterialId: materials.length > 0 ? materials[0].id : null,
        error: null
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load materials'
      }));
    }
  }, []);

  /**
   * Set selected material ID
   */
  const setSelectedMaterialId = useCallback((id: number) => {
    setState(prev => ({ ...prev, selectedMaterialId: id }));
  }, []);

  /**
   * Update simulation settings
   */
  const updateSimulationSettings = useCallback((settings: Partial<ChorasSimulationSettings>) => {
    setState(prev => ({
      ...prev,
      simulationSettings: { ...prev.simulationSettings, ...settings }
    }));
  }, []);

  /**
   * Load simulation results (shared logic)
   * Defined early so it can be used by both runSimulation and refreshProgress
   */
  const loadSimulationResults = async (simulationId: number) => {
    let irImportStatus = '';
    let resultsText = 'Simulation Complete!\n\n';

    // Small delay to ensure files are fully written
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Fetch and import the IR file - only if not already imported
    // Use persistentState to avoid stale closure issues
    if (!persistentState.irImported) {
      // Set flag IMMEDIATELY to prevent race conditions from concurrent calls
      persistentState.irImported = true;

      try {
        console.log('[loadSimulationResults] Fetching IR for simulation:', simulationId);
        const response = await fetch(`http://localhost:8000/choras/get-result-file/${simulationId}/wav`);
        if (response.ok) {
          const filename = `simulation_${simulationId}_impulse_response.wav`;
          const blob = await response.blob();
          const file = new File([blob], filename, { type: 'audio/wav' });

          // Upload to IR library
          const irName = `Choras_Sim${simulationId}_${Date.now()}`;
          await apiService.uploadImpulseResponse(file, irName);
          irImportStatus = '✓ Impulse response imported to library\n';

          // Notify parent to refresh IR list
          if (onIRImported) {
            onIRImported();
          }
        } else {
          irImportStatus = '⚠ Could not import impulse response\n';
        }
      } catch (error) {
        console.error('[loadSimulationResults] Failed to import IR:', error);
        irImportStatus = '⚠ Failed to import impulse response\n';
        // Don't reset the flag on error to avoid retry loops
      }
    } else {
      console.log('[loadSimulationResults] IR already imported, skipping...');
      irImportStatus = '✓ Impulse response imported to library\n';
    }

    // Fetch and parse results JSON
    try {
      console.log('[loadSimulationResults] Fetching results JSON for simulation:', simulationId);
      const response = await fetch(`http://localhost:8000/choras/get-result-file/${simulationId}/json`);
      if (response.ok) {
        const jsonData = await response.json();

        if (Array.isArray(jsonData) && jsonData.length > 0) {
          const sourceData = jsonData[0];
          const frequencies = sourceData.frequencies;
          const freqRange = frequencies && frequencies.length > 0
            ? `(${frequencies[0]}-${frequencies[frequencies.length - 1]} Hz)`
            : '';

          const receiverData = sourceData.responses?.[0];
          if (receiverData?.parameters) {
            const params = receiverData.parameters;
            const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

            resultsText += `Acoustic Metrics: ${freqRange}\n`;

            const metrics = [];
            if (params.t30) metrics.push(`T30: ${average(params.t30).toFixed(2)}s`);
            if (params.edt) metrics.push(`EDT: ${average(params.edt).toFixed(2)}s`);
            if (params.d50) metrics.push(`D50: ${average(params.d50).toFixed(1)}`);
            if (params.c80) metrics.push(`C80: ${average(params.c80).toFixed(1)} dB`);

            resultsText += metrics.join(', ') + '\n';
          }
        }
      }
    } catch (error) {
      console.error('[loadSimulationResults] Failed to parse results JSON:', error);
    }

    resultsText += '\n' + irImportStatus;

    // Update state and persistent state (irImported already set above)
    const newState = {
      ...persistentState,
      isRunning: false,
      status: 'Complete!',
      progress: 100,
      simulationResults: resultsText
    };
    persistentState = newState;
    setState(newState);

    // Show success notification
    addError('🎉 Simulation completed successfully! Impulse response imported to library.', 'info');
  };

  /**
   * Run Choras simulation
   */
  const runSimulation = useCallback(async (file: File, simulationName: string, receivers: any[], soundscapeData: any[]) => {
    if (!state.selectedMaterialId) {
      setState(prev => ({ ...prev, error: 'Please select a material' }));
      return;
    }

    setState(prev => ({
      ...prev,
      isRunning: true,
      status: 'Setting up simulation...',
      progress: 0,
      currentSimulationId: null,
      currentSimulationRunId: null,
      error: null,
      simulationResults: null,
      irImported: false
    }));

    try {
      // Note: For now, we'll use the direct Choras workflow from useChoras.ts
      // A proper backend endpoint should be created to handle this workflow
      const { runFullSimulation } = await import('./useChoras');
      
      const result = await runFullSimulation(
        file,
        state.selectedMaterialId,
        simulationName,
        (percentage, message) => {
          // Use ref to update state from async callbacks
          setStateRef.current(prev => {
            const newState = {
              ...prev,
              progress: percentage,
              status: message
            };
            persistentState = newState;
            return newState;
          });
        },
        (simulationId, simulationRunId) => {
          // Use ref to update state from async callbacks
          setStateRef.current(prev => {
            const newState = {
              ...prev,
              currentSimulationId: simulationId,
              currentSimulationRunId: simulationRunId
            };
            persistentState = newState;
            return newState;
          });
        },
        receivers,
        soundscapeData,
        state.simulationSettings
      );

      console.log('Simulation finished:', result);

      // Use centralized result loading function (handles IR import + results display)
      if (result.simulationId) {
        await loadSimulationResults(result.simulationId);
      } else {
        console.warn('[useChorasSimulation] No simulation ID in results:', result);
        setState(prev => ({
          ...prev,
          isRunning: false,
          status: 'Complete!',
          progress: 100,
          simulationResults: 'Simulation completed but no results available.'
        }));
      }

    } catch (error) {
      setState(prev => ({
        ...prev,
        isRunning: false,
        status: 'Error',
        progress: 0,
        error: error instanceof Error ? error.message : 'Simulation failed'
      }));
    }
  }, [state.selectedMaterialId, state.simulationSettings, onIRImported]);

  /**
   * Cancel running simulation
   */
  const cancelSimulation = useCallback(async () => {
    if (!state.currentSimulationId) return;

    try {
      await apiService.cancelChorasSimulation(state.currentSimulationId);
      setState(prev => ({
        ...prev,
        isRunning: false,
        status: 'Simulation cancelled by user',
        progress: 0,
        currentSimulationId: null,
        currentSimulationRunId: null,
        irImported: false
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to cancel simulation'
      }));
    }
  }, [state.currentSimulationId]);

  /**
   * Refresh progress from backend (for when tab changes cause UI freeze)
   */
  const refreshProgress = useCallback(async () => {
    if (!state.currentSimulationRunId || !state.currentSimulationId) {
      console.log('[refreshProgress] No active simulation to refresh');
      return;
    }

    try {
      console.log('[refreshProgress] Fetching status for simulation run:', state.currentSimulationRunId);

      // Import CHORAS_API_BASE from constants
      const { CHORAS_API_BASE } = await import('@/lib/constants');

      // Fetch all running simulations
      const response = await fetch(`${CHORAS_API_BASE}/simulations/run`);
      if (!response.ok) {
        console.warn('[refreshProgress] Failed to fetch simulation runs');
        return;
      }

      const allRuns = await response.json();
      const runInfo = allRuns.find((run: any) => run.id === state.currentSimulationRunId);

      if (!runInfo) {
        console.log('[refreshProgress] Simulation run not found in active runs, checking if completed...');

        // Check if completed by fetching individual simulation
        const statusRes = await fetch(`${CHORAS_API_BASE}/simulations/${state.currentSimulationId}`);
        if (statusRes.ok) {
          const simStatus = await statusRes.json();
          if (simStatus.simulationRun?.status === 'Completed' || simStatus.simulationRun?.completedAt) {
            console.log('[refreshProgress] Simulation completed! Fetching results...');

            // Fetch and display results
            await loadSimulationResults(state.currentSimulationId);
          }
        }
        return;
      }

      console.log('[refreshProgress] Current status:', {
        status: runInfo.status,
        percentage: runInfo.percentage,
        completedAt: runInfo.completedAt
      });

      // Update progress
      const newPercentage = runInfo.percentage || 0;
      setState(prev => ({
        ...prev,
        progress: newPercentage,
        status: `Running simulation: ${newPercentage}%`
      }));

      // Check if simulation is complete
      if (runInfo.status === 'Completed' || runInfo.completedAt) {
        console.log('[refreshProgress] Simulation completed! Fetching results...');
        await loadSimulationResults(state.currentSimulationId);
      } else if (runInfo.status === 'Error') {
        setState(prev => ({
          ...prev,
          isRunning: false,
          status: 'Error',
          error: 'Simulation failed. Check backend logs for details.'
        }));
      }
    } catch (error) {
      console.error('[refreshProgress] Error refreshing progress:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to refresh progress'
      }));
    }
  }, [state.currentSimulationRunId, state.currentSimulationId]);

  // Auto-load materials on mount
  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  return {
    state,
    methods: {
      loadMaterials,
      setSelectedMaterialId,
      updateSimulationSettings,
      runSimulation,
      cancelSimulation,
      refreshProgress
    }
  };
}
