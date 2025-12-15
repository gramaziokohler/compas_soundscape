/**
 * usePyroomAcousticsSimulation Hook
 * 
 * Manages Pyroomacoustics acoustic simulation workflow with typed state.
 * Handles material selection, simulation execution, and result management.
 * State persists across tab changes using per-instance storage.
 * 
 * @param simulationInstanceId - Unique identifier for this simulation instance
 * @param onIRImported - Callback when IR is imported to library
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '@/services/api';
import { useErrorNotification } from '@/contexts/ErrorContext';
import {
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
  PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_DEFAULT_SCATTERING,
  PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE
} from '@/lib/constants';
import type { SourceReceiverIRMapping } from '@/types/audio';

// Types
export interface PyroomAcousticsMaterial {
  id: string;
  name: string;
  description?: string;
  category?: string;
  absorption: number;
}

export interface PyroomAcousticsSimulationSettings {
  max_order: number;
  ray_tracing: boolean;
  air_absorption: boolean;
  n_rays: number;
  scattering: number;
  simulation_mode: string; // "mono", "binaural", or "foa"
}

export interface PyroomAcousticsSimulationState {
  materials: PyroomAcousticsMaterial[];
  faceMaterialAssignments: Record<number, string>; // face index -> material ID
  simulationSettings: PyroomAcousticsSimulationSettings;
  isRunning: boolean;
  status: string;
  error: string | null;
  simulationResults: string | null;
  currentSimulationId: string | null;
  irImported: boolean;
  importedIRIds?: string[]; // Array of imported IR IDs for filtering
  sourceReceiverIRMapping?: SourceReceiverIRMapping; // Source-receiver IR mapping for audio integration
}

export interface PyroomAcousticsSimulationMethods {
  loadMaterials: () => Promise<void>;
  assignMaterialToFace: (faceIndex: number, materialId: string) => void;
  clearFaceMaterialAssignments: () => void;
  updateSimulationSettings: (settings: Partial<PyroomAcousticsSimulationSettings>) => void;
  runSimulation: (file: File, simulationName: string, receivers: any[], soundscapeData: any[]) => Promise<void>;
}

// Module-level Map to store state per simulation instance
const persistentStates = new Map<string, PyroomAcousticsSimulationState>();

// Shared materials cache (same for all instances)
let sharedMaterialsCache: PyroomAcousticsMaterial[] = [];

// Default state factory
function createDefaultState(): PyroomAcousticsSimulationState {
  return {
    materials: sharedMaterialsCache,
    faceMaterialAssignments: {},
    simulationSettings: {
      max_order: PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
      ray_tracing: PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
      air_absorption: PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
      n_rays: PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
      scattering: PYROOMACOUSTICS_DEFAULT_SCATTERING,
      simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE
    },
    isRunning: false,
    status: 'Idle',
    error: null,
    simulationResults: null,
    currentSimulationId: null,
    irImported: false,
    importedIRIds: undefined,
    sourceReceiverIRMapping: undefined
  };
}

/**
 * Hook for managing Pyroomacoustics acoustic simulation workflow
 */
export function usePyroomAcousticsSimulation(simulationInstanceId: string, onIRImported?: () => void) {
  // Get or create state for this instance
  if (!persistentStates.has(simulationInstanceId)) {
    persistentStates.set(simulationInstanceId, createDefaultState());
  }

  const [state, setState] = useState<PyroomAcousticsSimulationState>(() => 
    persistentStates.get(simulationInstanceId)!
  );
  const isMounted = useRef(true);
  const { addError } = useErrorNotification();

  // Sync state changes back to persistent storage for this instance
  useEffect(() => {
    persistentStates.set(simulationInstanceId, state);
  }, [state, simulationInstanceId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  /**
   * Load available materials from Pyroomacoustics database
   */
  const loadMaterials = useCallback(async () => {
    try {
      const materials = await apiService.getPyroomacousticsMaterials();
      
      // Update shared cache
      sharedMaterialsCache = materials;
      
      // Update all instances with new materials
      persistentStates.forEach((instanceState, key) => {
        persistentStates.set(key, {
          ...instanceState,
          materials
        });
      });
      
      setState(prev => ({
        ...prev,
        materials,
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
   * Assign material to a specific face
   */
  const assignMaterialToFace = useCallback((faceIndex: number, materialId: string) => {
    console.log('[usePyroomAcousticsSimulation] Assigning material:', { faceIndex, materialId });
    setState(prev => ({
      ...prev,
      faceMaterialAssignments: {
        ...prev.faceMaterialAssignments,
        [faceIndex]: materialId
      }
    }));
  }, []);

  /**
   * Clear all face material assignments
   */
  const clearFaceMaterialAssignments = useCallback(() => {
    setState(prev => ({ ...prev, faceMaterialAssignments: {} }));
  }, []);

  /**
   * Update simulation settings
   */
  const updateSimulationSettings = useCallback((settings: Partial<PyroomAcousticsSimulationSettings>) => {
    setState(prev => ({
      ...prev,
      simulationSettings: { ...prev.simulationSettings, ...settings }
    }));
  }, []);

  /**
   * Run Pyroomacoustics simulation
   */
  const runSimulation = useCallback(async (
    file: File,
    simulationName: string,
    receivers: any[],
    soundscapeData: any[]
  ) => {
    console.log('🔴🔴🔴 PYROOMACOUSTICS SIMULATION STARTING - FILE LOADED! 🔴🔴🔴');

    // Get the current state for this instance to avoid stale closure
    const currentInstanceState = persistentStates.get(simulationInstanceId)!;
    const currentFaceMaterials = currentInstanceState.faceMaterialAssignments;
    const currentSettings = currentInstanceState.simulationSettings;

    console.log('[usePyroomAcousticsSimulation] Running simulation with:', {
      faceMaterialsCount: Object.keys(currentFaceMaterials).length,
      faceMaterials: currentFaceMaterials,
      settings: currentSettings
    });

    if (Object.keys(currentFaceMaterials).length === 0) {
      setState(prev => ({ ...prev, error: 'Please assign materials to at least one face' }));
      return;
    }

    setState(prev => ({
      ...prev,
      isRunning: true,
      status: 'Running simulation...',
      error: null,
      simulationResults: null,
      currentSimulationId: null,
      irImported: false,
      importedIRIds: undefined
    }));

    try {
      // Build source-receiver pairs from receivers and soundscape data
      const sourceReceiverPairs = [];
      
      for (const sound of soundscapeData) {
        // Validate sound position
        if (!sound.position || !Array.isArray(sound.position) || sound.position.length !== 3) {
          console.warn('[usePyroomAcousticsSimulation] Invalid sound position:', sound);
          addError(`Sound "${sound.display_name || sound.id}" has invalid position. Please recreate it.`);
          setState(prev => ({ 
            ...prev, 
            isRunning: false,
            error: `Sound "${sound.display_name || sound.id}" has invalid position. Please delete and recreate it.`
          }));
          return;
        }

        for (const receiver of receivers) {
          // Validate receiver position
          if (!receiver.position || !Array.isArray(receiver.position) || receiver.position.length !== 3) {
            console.warn('[usePyroomAcousticsSimulation] Invalid receiver position:', receiver);
            addError(`Receiver "${receiver.name || receiver.id}" has invalid position.`);
            setState(prev => ({ 
              ...prev, 
              isRunning: false,
              error: `Receiver "${receiver.name || receiver.id}" has invalid position.`
            }));
            return;
          }

          sourceReceiverPairs.push({
            source_position: sound.position,
            receiver_position: receiver.position,
            source_id: sound.id || sound.name,
            receiver_id: receiver.id
          });

          console.log('[usePyroomAcousticsSimulation] Created pair:', {
            source: sound.display_name || sound.id,
            source_position: sound.position,
            receiver: receiver.name || receiver.id,
            receiver_position: receiver.position
          });
        }
      }

      if (sourceReceiverPairs.length === 0) {
        throw new Error('No source-receiver pairs could be created');
      }

      // Run simulation (synchronous, no polling needed)
      const result = await apiService.runPyroomacousticsSimulation(
        file,
        simulationName,
        currentSettings,
        sourceReceiverPairs,
        currentFaceMaterials
      );

      console.log('Simulation completed:', result);
      console.log('[Pyroomacoustics] IR files returned from backend:', result.ir_files);
      console.log('[Pyroomacoustics] Number of IR files:', result.ir_files?.length);

      // Import ALL IR files to library AND build source-receiver mapping
      let irImportStatus = '';
      let importCount = 0;
      const importedIRMetadataList = [];
      const sourceReceiverMapping: SourceReceiverIRMapping = {};

      // Import each IR file
      if (result.ir_files && result.ir_files.length > 0) {
        console.log('[Pyroomacoustics] Starting import loop for', result.ir_files.length, 'IRs');
        for (const irFilename of result.ir_files) {
          console.log(`[Pyroomacoustics] Processing IR file: ${irFilename}`);
          try {
            // Fetch the specific IR file
            console.log(`[Pyroomacoustics] Fetching IR from backend: ${irFilename}`);
            const blob = await apiService.getPyroomacousticsIRFile(result.simulation_id, irFilename);
            console.log(`[Pyroomacoustics] Received blob, size: ${blob.size} bytes`);

            // Create File object from blob
            const file = new File([blob], irFilename, { type: 'audio/wav' });

            // Extract source and receiver IDs from filename
            // Format: sim_{simulation_id}_src_{source_id}_rcv_{receiver_id}.wav
            const match = irFilename.match(/src_(.+?)_rcv_(.+?)\.wav$/);
            const sourceId = match ? match[1] : 'unknown';
            const receiverId = match ? match[2] : 'unknown';

            // Upload to IR library with descriptive name
            const irName = `Pyroom_${simulationName}_S${sourceId}_R${receiverId}`;
            const irMetadata = await apiService.uploadImpulseResponse(file, irName);
            importedIRMetadataList.push(irMetadata);
            importCount++;

            // Build source-receiver IR mapping
            if (!sourceReceiverMapping[sourceId]) {
              sourceReceiverMapping[sourceId] = {};
            }
            sourceReceiverMapping[sourceId][receiverId] = irMetadata;

            console.log(`✓ Imported IR: ${irName} (source: ${sourceId}, receiver: ${receiverId})`);
          } catch (error) {
            console.error(`Failed to import IR ${irFilename}:`, error);
          }
        }

        // Update import status
        if (importCount > 0) {
          irImportStatus = `✓ ${importCount} of ${result.ir_files.length} impulse response(s) imported to library\n`;

          // Store ALL imported IR IDs and source-receiver mapping in persistent state
          const importedIds = importedIRMetadataList.map(metadata => metadata.id);
          const updatedState = persistentStates.get(simulationInstanceId)!;
          persistentStates.set(simulationInstanceId, {
            ...updatedState,
            importedIRIds: importedIds,
            sourceReceiverIRMapping: sourceReceiverMapping
          });

          console.log(`[Pyroomacoustics] Stored ${importedIds.length} IR IDs for filtering:`, importedIds);
          console.log('[Pyroomacoustics] Source-Receiver IR Mapping:', sourceReceiverMapping);

          // Notify parent to refresh IR list
          if (onIRImported) {
            onIRImported();
          }
        } else {
          irImportStatus = '⚠ Failed to import impulse responses\n';
        }
      }

      // Format results message
      let resultsText = 'Simulation Complete!\n\n';
      resultsText += `Generated ${result.ir_files.length} impulse response(s)\n`;
      
      // Fetch and display acoustic metrics from results JSON
      try {
        const jsonResponse = await fetch(
          `http://localhost:8000/pyroomacoustics/get-result-file/${result.simulation_id}/json`
        );
        
        if (jsonResponse.ok) {
          const jsonData = await jsonResponse.json();
          
          if (jsonData.results && Array.isArray(jsonData.results) && jsonData.results.length > 0) {
            // Calculate average acoustic parameters across all source-receiver pairs
            const allParams = jsonData.results
              .filter((r: any) => r.acoustic_parameters)
              .map((r: any) => r.acoustic_parameters);
            
            if (allParams.length > 0) {
              const average = (key: string) => {
                const values = allParams.map((p: any) => p[key]).filter((v: any) => v !== undefined && !isNaN(v));
                return values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null;
              };
              
              const rt60 = average('rt60');
              const edt = average('edt');
              const d50 = average('d50');
              const c80 = average('c80');
              
              resultsText += 'Acoustic Metrics:\n';
              const metrics = [];
              if (rt60 !== null) metrics.push(`RT60: ${rt60.toFixed(2)}s`);
              if (edt !== null) metrics.push(`EDT: ${edt.toFixed(2)}s`);
              if (d50 !== null) metrics.push(`D50: ${(d50 * 100).toFixed(1)}%`);
              if (c80 !== null) metrics.push(`C80: ${c80.toFixed(1)} dB`);
              
              if (metrics.length > 0) {
                resultsText += metrics.join(', ') + '\n';
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch acoustic metrics:', error);
      }
      
      resultsText += '\n' + irImportStatus;

      setState(prev => ({
        ...prev,
        isRunning: false,
        status: 'Complete!',
        simulationResults: resultsText,
        currentSimulationId: result.simulation_id,
        irImported: importCount > 0
      }));

      // Success notification with proper pluralization
      const irWord = importCount === 1 ? 'response' : 'responses';
      addError(
        `🎉 Simulation completed successfully! ${importCount} impulse ${irWord} imported to library.`,
        'info'
      );

    } catch (error) {
      setState(prev => ({
        ...prev,
        isRunning: false,
        status: 'Error',
        error: error instanceof Error ? error.message : 'Simulation failed'
      }));
    }
  }, [onIRImported, addError]);

  // Auto-load materials on mount
  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  return {
    state,
    methods: {
      loadMaterials,
      assignMaterialToFace,
      clearFaceMaterialAssignments,
      updateSimulationSettings,
      runSimulation
    }
  };
}
