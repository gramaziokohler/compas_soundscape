/**
 * useAcousticsSimulation Hook
 * 
 * Main hook for managing multiple acoustic simulation configurations.
 * Handles adding, removing, updating, and activating simulation tabs.
 * Each simulation retains its settings when switching between tabs.
 */

import { useState, useCallback, useEffect } from 'react';
import type { 
  SimulationConfig, 
  AcousticSimulationMode,
  ChorasSimulationConfig,
  PyroomAcousticsSimulationConfig,
  ResonanceSimulationConfig
} from '@/types/acoustics';
import {
  CHORAS_DEFAULT_C0,
  CHORAS_DEFAULT_IR_LENGTH,
  CHORAS_DEFAULT_LC,
  CHORAS_DEFAULT_EDT,
  CHORAS_DEFAULT_SIM_LEN_TYPE,
  PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
  PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
  PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
  PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
  PYROOMACOUSTICS_DEFAULT_ENABLE_GRID
} from '@/utils/constants';
import { CARD_TYPE_LABELS } from '@/types/card';

export interface UseAcousticsSimulationReturn {
  // State
  simulationConfigs: SimulationConfig[];
  activeSimulationIndex: number | null;
  expandedTabIndex: number | null;

  // Actions
  handleAddConfig: (mode: AcousticSimulationMode) => void;
  handleRemoveConfig: (index: number) => void;
  handleUpdateConfig: (index: number, updates: Partial<SimulationConfig>) => void;
  handleSetActiveSimulation: (index: number | null) => void;
  handleUpdateSimulationName: (index: number, name: string) => void;
  handleToggleExpand: (index: number) => void;
  restoreSimulationState: (savedConfigs: SimulationConfig[], savedActiveIndex: number | null) => void;
}

// Module-level persistent state to survive component unmounts (e.g., tab switching)
let persistentState = {
  simulationConfigs: [] as SimulationConfig[],
  activeSimulationIndex: null as number | null,
  expandedTabIndex: null as number | null,
  simulationCounter: 1
};

/**
 * Main hook for acoustics simulation management
 * State persists across tab switches using module-level singleton.
 */
export function useAcousticsSimulation(): UseAcousticsSimulationReturn {
  const [simulationConfigs, setSimulationConfigs] = useState<SimulationConfig[]>(persistentState.simulationConfigs);
  const [activeSimulationIndex, setActiveSimulationIndex] = useState<number | null>(persistentState.activeSimulationIndex);
  const [expandedTabIndex, setExpandedTabIndex] = useState<number | null>(persistentState.expandedTabIndex);
  const [simulationCounter, setSimulationCounter] = useState(persistentState.simulationCounter);

  // Sync state changes back to persistent storage
  useEffect(() => {
    persistentState.simulationConfigs = simulationConfigs;
  }, [simulationConfigs]);

  useEffect(() => {
    persistentState.activeSimulationIndex = activeSimulationIndex;
  }, [activeSimulationIndex]);

  useEffect(() => {
    persistentState.expandedTabIndex = expandedTabIndex;
  }, [expandedTabIndex]);

  useEffect(() => {
    persistentState.simulationCounter = simulationCounter;
  }, [simulationCounter]);

  /**
   * Add a new simulation configuration
   */
  const handleAddConfig = useCallback((mode: AcousticSimulationMode) => {
    const timestamp = Date.now();
    const id = `sim_${timestamp}`;
    const name = `${CARD_TYPE_LABELS[mode]} ${simulationCounter}`;
    
    let newConfig: SimulationConfig;
    
    switch (mode) {
      case 'resonance':
        newConfig = {
          id,
          display_name: name,
          type: 'resonance',
          state: 'idle',
          createdAt: timestamp
        } as ResonanceSimulationConfig;
        break;
        
      case 'choras':
        newConfig = {
          id,
          display_name: name,
          type: 'choras',
          state: 'before-simulation',
          createdAt: timestamp,
          simulationInstanceId: `choras_${timestamp}`, // Unique instance ID
          settings: {
            de_c0: CHORAS_DEFAULT_C0,
            de_ir_length: CHORAS_DEFAULT_IR_LENGTH,
            de_lc: CHORAS_DEFAULT_LC,
            edt: CHORAS_DEFAULT_EDT,
            sim_len_type: CHORAS_DEFAULT_SIM_LEN_TYPE as 'ir_length' | 'edt',
            selectedMaterialId: null
          },
          faceToMaterialMap: new Map(),
          isRunning: false,
          progress: 0,
          status: 'Idle',
          error: null,
          currentSimulationId: null,
          currentSimulationRunId: null,
          simulationResults: null
        } as ChorasSimulationConfig;
        break;
        
      case 'pyroomacoustics':
        newConfig = {
          id,
          display_name: name,
          type: 'pyroomacoustics',
          state: 'before-simulation',
          createdAt: timestamp,
          simulationInstanceId: `pyroom_${timestamp}`, // Unique instance ID
          settings: {
            max_order: PYROOMACOUSTICS_DEFAULT_MAX_ORDER,
            ray_tracing: PYROOMACOUSTICS_DEFAULT_RAY_TRACING,
            air_absorption: PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION,
            n_rays: PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
            simulation_mode: PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE,
            enable_grid: PYROOMACOUSTICS_DEFAULT_ENABLE_GRID
          },
          faceToMaterialMap: new Map(),
          isRunning: false,
          progress: 0,
          status: 'Idle',
          error: null,
          simulationResults: null
        } as PyroomAcousticsSimulationConfig;
        break;
    }
    
    setSimulationConfigs(prev => [...prev, newConfig]);
    setSimulationCounter(prev => prev + 1);
    
    // Auto-activate and expand the new simulation
    const newIndex = simulationConfigs.length;
    setActiveSimulationIndex(newIndex);
    setExpandedTabIndex(newIndex);
  }, [simulationCounter, simulationConfigs.length]);

  /**
   * Remove a simulation configuration
   */
  const handleRemoveConfig = useCallback((index: number) => {
    setSimulationConfigs(prev => prev.filter((_, i) => i !== index));
    
    // Adjust active simulation index
    if (activeSimulationIndex === index) {
      setActiveSimulationIndex(null);
    } else if (activeSimulationIndex !== null && activeSimulationIndex > index) {
      setActiveSimulationIndex(activeSimulationIndex - 1);
    }
    
    // Adjust expanded tab index
    if (expandedTabIndex === index) {
      setExpandedTabIndex(null);
    } else if (expandedTabIndex !== null && expandedTabIndex > index) {
      setExpandedTabIndex(expandedTabIndex - 1);
    }
  }, [activeSimulationIndex, expandedTabIndex]);

  /**
   * Update a simulation configuration
   */
  const handleUpdateConfig = useCallback((index: number, updates: Partial<SimulationConfig>) => {
    setSimulationConfigs(prev => {
      // Optimization: Check if updates actually change anything to avoid re-renders
      const currentConfig = prev[index];
      if (!currentConfig) return prev;

      const hasChanges = Object.entries(updates).some(([key, value]) => {
        const currentValue = (currentConfig as any)[key];
        // Weak check sufficient to stop trivial loops (primitive values same)
        // We do NOT want to block object updates (like sourceReceiverIRMapping) even if they look similar
        return currentValue !== value;
      });

      if (!hasChanges) return prev;

      return prev.map((config, i) => {
        if (i !== index) return config;
        
        // Deep merge to preserve Map instances
        const updated = { ...config };
        Object.keys(updates).forEach(key => {
          const updateKey = key as keyof SimulationConfig;
          (updated as any)[updateKey] = (updates as any)[updateKey];
        });
        
        return updated as SimulationConfig;
      });
    });
  }, []);

  /**
   * Set the active simulation (applied to audio orchestrator)
   */
  const handleSetActiveSimulation = useCallback((index: number | null) => {
    setActiveSimulationIndex(index);
    
    // Auto-expand the activated simulation
    if (index !== null) {
      setExpandedTabIndex(index);
    }
  }, []);

  /**
   * Update simulation name
   */
  const handleUpdateSimulationName = useCallback((index: number, name: string) => {
    setSimulationConfigs(prev => prev.map((config, i) => 
      i === index ? { ...config, display_name: name } : config
    ));
  }, []);

  /**
   * Toggle expansion of a simulation tab
   */
  const handleToggleExpand = useCallback((index: number) => {
    setExpandedTabIndex(prev => prev === index ? null : index);
  }, []);

  /**
   * Restore simulation state from saved soundscape data.
   * Replaces current configs and active index with saved data.
   */
  const restoreSimulationState = useCallback((savedConfigs: SimulationConfig[], savedActiveIndex: number | null) => {
    setSimulationConfigs(savedConfigs);
    setActiveSimulationIndex(savedActiveIndex);
    if (savedActiveIndex !== null) {
      setExpandedTabIndex(savedActiveIndex);
    }
    // Ensure counter is high enough to avoid ID collisions
    setSimulationCounter(prev => Math.max(prev, savedConfigs.length + 1));
  }, []);

  return {
    simulationConfigs,
    activeSimulationIndex,
    expandedTabIndex,
    handleAddConfig,
    handleRemoveConfig,
    handleUpdateConfig,
    handleSetActiveSimulation,
    handleUpdateSimulationName,
    handleToggleExpand,
    restoreSimulationState,
  };
}
