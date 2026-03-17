/**
 * Acoustics Simulation Types
 * 
 * Types for acoustic simulation configurations, modes, and states.
 */

import type { ReceiverData, SoundEvent, CompasGeometry } from './index';
import type { ImpulseResponseMetadata } from './audio';
import type { AcousticMaterial } from './materials';
import type { CardBaseConfig, CardType, CardExecutionState } from './card';

/**
 * Acoustic simulation modes
 */
export type AcousticSimulationMode = 'resonance' | 'choras' | 'pyroomacoustics';

/**
 * Simulation states for UI display
 */
export type SimulationState = 'idle' | 'before-simulation' | 'running' | 'completed' | 'error';

/**
 * Base configuration for all acoustic simulations
 */
export interface BaseSimulationConfig extends CardBaseConfig {
  id: string;
  type: AcousticSimulationMode;
  state: SimulationState;
  createdAt: number; // Timestamp
  simulationInstanceId?: string; // Unique ID to track which hook instance this config is bound to
}

/**
 * Resonance Audio configuration
 */
export interface ResonanceSimulationConfig extends BaseSimulationConfig {
  type: 'resonance';
  // Settings stored in resonanceAudioConfig (passed separately)
}

/**
 * Choras simulation configuration
 */
export interface ChorasSimulationConfig extends BaseSimulationConfig, CardExecutionState {
  type: 'choras';
  settings: {
    de_c0: number; // Speed of sound in m/s
    de_ir_length: number; // Impulse response length in seconds
    de_lc: number; // Characteristic length in meters
    edt: number; // Energy decay threshold in dB
    sim_len_type: 'ir_length' | 'edt'; // Simulation length type
    selectedMaterialId: string | null;
  };
  // Material assignments per face (persisted per simulation instance)
  faceToMaterialMap: Map<number, string>; // faceIndex -> materialId
  // Material UI state (persisted across tab switches)
  expandedMaterialItems?: Set<string>; // Expanded tree items (e.g., 'all', 'layer-Default', 'entity-0')
  // Excluded layers (layers not included in simulation or selection)
  excludedLayers?: Set<string>; // Set of layer IDs to exclude from simulation and selection
  // Saved settings for reset functionality (snapshot before simulation)
  savedSettings?: {
    settings: ChorasSimulationConfig['settings'];
    faceToMaterialMap: Map<number, string>;
    expandedMaterialItems?: Set<string>;
    excludedLayers?: Set<string>;
  };
  // Runtime state (inherited from CardExecutionState)
  currentSimulationId: string | null;
  currentSimulationRunId: string | null;
  simulationResults: string | null;
  importedIRMetadata?: ImpulseResponseMetadata;
}

/**
 * Pyroomacoustics simulation configuration
 */
export interface PyroomAcousticsSimulationConfig extends BaseSimulationConfig, CardExecutionState {
  type: 'pyroomacoustics';
  settings: {
    max_order: number;
    ray_tracing: boolean;
    air_absorption: boolean;
    n_rays: number;
    simulation_mode: string; // "mono" or "foa" (directivity-based, supports ISM and hybrid ray tracing)
    enable_grid: boolean; // Enable grid receiver simulation (heatmap export)
  };
  // Material assignments per face
  faceToMaterialMap: Map<number, string>; // faceIndex -> materialId
  // Material UI state (persisted across tab switches)
  expandedMaterialItems?: Set<string>; // Expanded tree items (e.g., 'all', 'layer-Default', 'entity-0')
  // Excluded layers (layers not included in simulation or selection)
  excludedLayers?: Set<string>; // Set of layer IDs to exclude from simulation and selection
  // Saved settings for reset functionality (snapshot before simulation)
  savedSettings?: {
    settings: PyroomAcousticsSimulationConfig['settings'];
    faceToMaterialMap: Map<number, string>;
    expandedMaterialItems?: Set<string>;
    excludedLayers?: Set<string>;
  };
  // Runtime state (inherited)
  simulationResults: string | null;
  importedIRMetadata?: ImpulseResponseMetadata;
  // Source-receiver IR mapping (for audio integration)
  importedIRIds?: string[]; // Array of imported IR IDs for filtering
  sourceReceiverIRMapping?: import('./audio').SourceReceiverIRMapping; // Source-receiver IR mapping
}

/**
 * Union type for all simulation configs
 */
export type SimulationConfig = ResonanceSimulationConfig | ChorasSimulationConfig | PyroomAcousticsSimulationConfig;

/**
 * Props for SimulationTab component (analogous to SoundTab)
 */
export interface SimulationTabProps {
  config: SimulationConfig;
  index: number;
  isExpanded: boolean;
  isActive: boolean; // Whether this simulation is currently applied to audio orchestrator
  
  // Callbacks
  onToggleExpand: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<SimulationConfig>) => void;
  onRemove: (index: number) => void;
  onActivate: (index: number) => void;
  onUpdateName: (index: number, name: string) => void;
  
  // Simulation execution
  onRunSimulation?: (index: number) => Promise<void>;
  onCancelSimulation?: (index: number) => void;
  
  // Shared props for all modes
  modelFile?: File | null;
  geometryData?: CompasGeometry | null;
  receivers?: ReceiverData[];
  soundscapeData?: SoundEvent[] | null;
  
  // Material assignment (for Choras and Pyroomacoustics)
  availableMaterials?: AcousticMaterial[];
  modelEntities?: any[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  
  // IR Library
  onIRImported?: () => void;
  irRefreshTrigger?: number;
  onSelectIRFromLibrary?: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
}
