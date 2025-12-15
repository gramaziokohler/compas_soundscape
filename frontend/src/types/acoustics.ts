/**
 * Acoustics Simulation Types
 * 
 * Types for acoustic simulation configurations, modes, and states.
 */

import type { ReceiverData, SoundEvent, CompasGeometry } from './index';
import type { ImpulseResponseMetadata } from './audio';
import type { AcousticMaterial } from './materials';

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
export interface BaseSimulationConfig {
  id: string;
  name: string; // User-editable name (e.g., "Simulation 1")
  mode: AcousticSimulationMode;
  state: SimulationState;
  createdAt: number; // Timestamp
  simulationInstanceId?: string; // Unique ID to track which hook instance this config is bound to
}

/**
 * Resonance Audio configuration
 */
export interface ResonanceSimulationConfig extends BaseSimulationConfig {
  mode: 'resonance';
  // Settings stored in resonanceAudioConfig (passed separately)
}

/**
 * Choras simulation configuration
 */
export interface ChorasSimulationConfig extends BaseSimulationConfig {
  mode: 'choras';
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
  // Runtime state
  isRunning: boolean;
  progress: number; // 0-100
  status: string;
  error: string | null;
  currentSimulationId: string | null;
  currentSimulationRunId: string | null;
  simulationResults: string | null;
  importedIRMetadata?: ImpulseResponseMetadata;
}

/**
 * Pyroomacoustics simulation configuration
 */
export interface PyroomAcousticsSimulationConfig extends BaseSimulationConfig {
  mode: 'pyroomacoustics';
  settings: {
    max_order: number;
    ray_tracing: boolean;
    air_absorption: boolean;
    n_rays: number;
    scattering: number;
    simulation_mode: string; // "mono", "binaural", or "foa"
  };
  // Material assignments per face
  faceToMaterialMap: Map<number, string>; // faceIndex -> materialId
  // Material UI state (persisted across tab switches)
  expandedMaterialItems?: Set<string>; // Expanded tree items (e.g., 'all', 'layer-Default', 'entity-0')
  // Runtime state
  isRunning: boolean;
  status: string;
  error: string | null;
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
