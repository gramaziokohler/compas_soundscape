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
  importPyroomIRFiles,
  buildSimulationResultsText,
  type IRImportResult
} from '@/utils/acousticMetrics';
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

export interface SpeckleData {
  model_id: string;
  version_id: string;
  object_id: string;
  url: string;
  auth_token?: string;
}

export interface PyroomAcousticsSimulationMethods {
  loadMaterials: () => Promise<void>;
  assignMaterialToFace: (faceIndex: number, materialId: string) => void;
  clearFaceMaterialAssignments: () => void;
  updateSimulationSettings: (settings: Partial<PyroomAcousticsSimulationSettings>) => void;
  runSpeckleSimulation: (
    speckleData: SpeckleData,
    simulationName: string,
    receivers: any[],
    soundscapeData: any[],
    materialAssignments: Record<string, string>,
    layerName?: string | null
  ) => Promise<void>;
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
   * Shared post-simulation handler: imports IRs, builds results, updates state
   */
  const handleSimulationComplete = useCallback(async (
    result: { simulation_id: string; ir_files?: string[] }
  ) => {
    console.log('Simulation completed:', result);
    console.log('[Pyroomacoustics] IR files returned from backend:', result.ir_files);

    // Import all IR files using shared utility
    let irImportResult: IRImportResult = { 
      importedCount: 0, 
      totalCount: 0, 
      importedIRIds: [], 
      importedIRMetadataList: [], 
      sourceReceiverMapping: {} 
    };

    if (result.ir_files && result.ir_files.length > 0) {
      irImportResult = await importPyroomIRFiles(
        result.simulation_id,
        result.ir_files
      );

      if (irImportResult.importedCount > 0) {
        // Store imported IR IDs and mapping in persistent state
        const updatedState = persistentStates.get(simulationInstanceId)!;
        persistentStates.set(simulationInstanceId, {
          ...updatedState,
          importedIRIds: irImportResult.importedIRIds,
          sourceReceiverIRMapping: irImportResult.sourceReceiverMapping
        });

        console.log(`[Pyroomacoustics] Stored ${irImportResult.importedIRIds.length} IR IDs for filtering`);

        // Notify parent to refresh IR list
        if (onIRImported) {
          onIRImported();
        }
      }
    }

    // Build results text using shared utility
    const resultsText = await buildSimulationResultsText(result.simulation_id, irImportResult);

    setState(prev => ({
      ...prev,
      isRunning: false,
      status: 'Complete!',
      simulationResults: resultsText,
      currentSimulationId: result.simulation_id,
      irImported: irImportResult.importedCount > 0
    }));

    // Success notification with proper pluralization
    const irWord = irImportResult.importedCount === 1 ? 'response' : 'responses';
    addError(
      `🎉 Simulation completed! ${irImportResult.importedCount} impulse ${irWord} imported to library.`,
      'info'
    );
  }, [simulationInstanceId, onIRImported, addError]);

  /**
   * Build and validate source-receiver pairs from receivers and soundscape data
   */
  const buildSourceReceiverPairs = useCallback((
    receivers: any[],
    soundscapeData: any[]
  ): { pairs: any[]; error: string | null } => {
    const sourceReceiverPairs = [];

    for (const sound of soundscapeData) {
      if (!sound.position || !Array.isArray(sound.position) || sound.position.length !== 3) {
        return { pairs: [], error: `Sound "${sound.display_name || sound.id}" has invalid position.` };
      }

      for (const receiver of receivers) {
        if (!receiver.position || !Array.isArray(receiver.position) || receiver.position.length !== 3) {
          return { pairs: [], error: `Receiver "${receiver.name || receiver.id}" has invalid position.` };
        }

        sourceReceiverPairs.push({
          source_position: sound.position,
          receiver_position: receiver.position,
          source_id: sound.id || sound.name,
          receiver_id: receiver.id
        });
      }
    }

    if (sourceReceiverPairs.length === 0) {
      return { pairs: [], error: 'No source-receiver pairs could be created' };
    }

    return { pairs: sourceReceiverPairs, error: null };
  }, []);

  /**
   * Run Pyroomacoustics simulation via Speckle
   * This method uses Speckle geometry instead of a local file
   */
  const runSpeckleSimulation = useCallback(async (
    speckleData: SpeckleData,
    simulationName: string,
    receivers: any[],
    soundscapeData: any[],
    materialAssignments: Record<string, string>,
    layerName?: string | null
  ) => {
    console.log('[usePyroomAcousticsSimulation] Running Speckle simulation');

    const currentInstanceState = persistentStates.get(simulationInstanceId)!;
    const currentSettings = currentInstanceState.simulationSettings;

    if (Object.keys(materialAssignments).length === 0) {
      setState(prev => ({ ...prev, error: 'Assign materials first' }));
      return;
    }

    // Validate and build source-receiver pairs
    const { pairs: sourceReceiverPairs, error: pairsError } = buildSourceReceiverPairs(receivers, soundscapeData);
    if (pairsError) {
      addError(pairsError);
      setState(prev => ({ ...prev, error: pairsError }));
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
      // Prepare object materials (strip pyroom_ prefix)
      const objectMaterials: Record<string, string> = {};
      Object.entries(materialAssignments).forEach(([objectId, materialId]) => {
        objectMaterials[objectId] = materialId.replace(/^pyroom_/, '');
      });

      // Parse Speckle URL for project/model IDs
      const urlMatch = speckleData.url.match(/\/projects\/([^\/]+)\/models\/([^\/\?#]+)/);
      if (!urlMatch) throw new Error('Invalid Speckle URL');
      const projectId = urlMatch[1];
      const modelId = urlMatch[2];

      const result = await apiService.runPyroomacousticsSimulationSpeckle(
        projectId,
        modelId,
        objectMaterials,
        layerName || '',
        simulationName,
        currentSettings,
        sourceReceiverPairs
      );

      // Handle post-simulation (IR import, results, state update)
      await handleSimulationComplete(result);

    } catch (error) {
      setState(prev => ({
        ...prev,
        isRunning: false,
        status: 'Error',
        error: error instanceof Error ? error.message : 'Simulation failed'
      }));
    }
  }, [simulationInstanceId, buildSourceReceiverPairs, handleSimulationComplete, addError]);

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
      runSpeckleSimulation
    }
  };
}
