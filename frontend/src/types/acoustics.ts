/**
 * Acoustics Simulation Types
 * 
 * Types for acoustic simulation configurations, modes, and states.
 */

import type { ReceiverData, SoundEvent, CompasGeometry } from './index';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping, ResonanceRoomMaterial } from './audio';
import type { AcousticMaterial } from './materials';
import type { CardBaseConfig, CardType, CardExecutionState, SavedObjectVisibility } from './card';
import type { PffdtdPrecision, PffdtdSettings, PffdtdVoxelProblem } from './pffdtd';
import type { SoundDirectivity } from './directivity';

/**
 * Snapshot of a grid listener's configuration captured at simulation time.
 * Used to detect grid "drift" (points moved by editing spacing/zOffset or the
 * bounding box) and to restore the grid card back to its simulation-time
 * x/y/z values and linked object.
 */
export interface GridListenerSnapshot {
  id: string;
  name: string;
  xSpacing: number;
  ySpacing: number;
  zOffset: number;
  selectedObjectIds: string[];
  boundingBox: { min: [number, number, number]; max: [number, number, number] } | null;
  points: [number, number, number][];
}

/**
 * Acoustic simulation modes
 */
export type AcousticSimulationMode = 'resonance' | 'pyroomacoustics' | 'pffdtd' | 'hybrid' | 'import-irs';

/** What the "add simulation" menu creates: a simulation type, or 'hybrid2' (a hybrid card with uiVersion 2). */
export type SimulationCardMode = AcousticSimulationMode | 'hybrid2';

/** The add-menu mode that recreates a card (duplicate): Hybrid simulation 2 stays a version-2 card. */
export function simulationCardMode(config: { type: AcousticSimulationMode; uiVersion?: number }): SimulationCardMode {
  return config.type === 'hybrid' && config.uiVersion === 2 ? 'hybrid2' : config.type;
}

/**
 * Simulation states for UI display
 */
export type SimulationState = 'idle' | 'before-simulation' | 'running' | 'completed' | 'error';

/**
 * Snapshot of the acoustic region (Object Explorer selection) a simulation was
 * configured with. Captured when the card's materials/region are set (before the
 * card is generated) so a later region re-assignment can be detected and undone.
 */
export interface SimulationAcousticSelection {
  nodeIds: string[];
  nodeNames: string[];
  geometryIds: string[];
  isWholeModel: boolean;
  autoDetected: boolean;
}

/**
 * Base configuration for all acoustic simulations
 */
export interface BaseSimulationConfig extends CardBaseConfig {
  id: string;
  type: AcousticSimulationMode;
  state: SimulationState;
  createdAt: number; // Timestamp
  completedAt?: number; // Timestamp when simulation finished
  simulationInstanceId?: string; // Unique ID to track which hook instance this config is bound to
  /** Acoustic region this card was simulated with (see SimulationAcousticSelection). */
  speckleAcousticSelection?: SimulationAcousticSelection;
  /** Object Explorer hide / isolate state saved on this card; restored when it is powered on. */
  savedObjectVisibility?: SavedObjectVisibility;
  /** Speckle version the completed result was simulated on (geometry-change / outdated detection). */
  simulatedVersionId?: string;
}

/** Axis-aligned shoebox used by a Resonance (ShoeBox) card. */
export interface ResonanceRoomBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Per-card Resonance room: independent bounds and wall materials. */
export interface ResonanceRoom {
  /** Null until model/sandbox bounds are known; filled lazily. */
  bounds: ResonanceRoomBounds | null;
  materials: ResonanceRoomMaterial;
}

/**
 * Resonance Audio configuration
 */
export interface ResonanceSimulationConfig extends BaseSimulationConfig {
  type: 'resonance';
  room: ResonanceRoom;
}

/**
 * Settings only the compas_acoustics engine runs (all optional: absent = default, so cards saved
 * before the engine switch load unchanged). Defaults: `GA_ENGINE` in utils/constants.ts.
 */
export interface GeometricEngineSettings {
  /** 'auto' (backend default) | 'compas_acoustics' | 'pyroomacoustics' */
  engine?: string;
  /** Edge diffraction: 'off' | 'udfa' | 'btms' (btms: ambisonic output only). */
  diffraction?: string;
  /** Ambisonic order of the 'hoa' mode (2 or 3). */
  ambisonic_order?: number;
  /** Ambisonic late field: 'auto' | 'reference' | 'eyring' | 'sabine'. */
  tail?: string;
  /** Decay slopes of the late field (2+ for coupled volumes). */
  n_slopes?: number;
  /** Random seed of the ray tracing and the late field (same seed = same result). */
  seed?: number;
  /** Split the early part into specular and scattered contributions. */
  scattering_split?: boolean;
  /** Air temperature in deg C; null/absent = derived from the global sound speed. */
  air_temperature?: number | null;
  /** Relative humidity in %. */
  air_humidity?: number;
  /** Diffraction edges switched off: [x1, y1, z1, x2, y2, z2] in model coordinates. */
  excluded_edges?: number[][];
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
    parallel: boolean; // one process per emitter room on the backend
    simulation_mode: string; // "mono", "foa" or "hoa" (hoa: compas_acoustics engine, ambisonic_order 2-3)
    enable_grid: boolean; // Enable grid receiver simulation (heatmap export)
  } & GeometricEngineSettings;
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
  sourceReceiverIRMapping?: SourceReceiverIRMapping; // Source-receiver IR mapping
  /** Positions of sources and receivers at the time the simulation was run (source of truth for IR hover line) */
  simulationPositions?: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
    soundToPosKey?: Record<string, string>;
    /** Directivity of each directional source key at simulation time. */
    sourceDirectivities?: Record<string, SoundDirectivity>;
    /** Grid listener configs at simulation time (for drift detection + reset) */
    gridListeners?: GridListenerSnapshot[];
  };
}

/**
 * PFFDTD (GPU finite-difference wave solver) configuration.
 * Same shape as the pyroomacoustics card (materials, IR mapping, positions);
 * only the settings differ. Scattering is not used by the wave solver.
 */
export interface PffdtdSimulationConfig extends BaseSimulationConfig, CardExecutionState {
  type: 'pffdtd';
  settings: PffdtdSettings;
  faceToMaterialMap: Map<number, string>;
  expandedMaterialItems?: Set<string>;
  excludedLayers?: Set<string>;
  savedSettings?: {
    settings: PffdtdSettings;
    faceToMaterialMap: Map<number, string>;
    expandedMaterialItems?: Set<string>;
    excludedLayers?: Set<string>;
  };
  simulationResults: string | null;
  importedIRMetadata?: ImpulseResponseMetadata;
  importedIRIds?: string[];
  sourceReceiverIRMapping?: SourceReceiverIRMapping;
  /** Backend simulation id of the completed run (results JSON + field files). */
  currentSimulationId?: string | null;
  /** Unified job id of the in-flight run. */
  currentSimulationRunId?: string | null;
  /** The in-flight run has finished voxelising (the voxel preview may run alongside the GPU solve). */
  runVoxelised?: boolean;
  /** Grid problems the last run reported after voxelising (kept with its result). */
  runProblems?: PffdtdVoxelProblem[];
  speckleMaterialAssignments?: Record<string, string>;
  speckleLayerName?: string | null;
  speckleGeometryObjectIds?: string[];
  speckleIsolatedObjectIds?: string[] | null;
  simulationPositions?: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
    soundToPosKey?: Record<string, string>;
    /** Directivity of each directional source key at simulation time. */
    sourceDirectivities?: Record<string, SoundDirectivity>;
    gridListeners?: GridListenerSnapshot[];
  };
}

/**
 * Which parts a hybrid run simulates: both (wave below the crossover, rays above), the wave solver
 * alone up to the crossover, or the rays alone over the full band. Only Hybrid simulation 2 sets it.
 */
export type HybridParts = 'both' | 'wave' | 'rays';

/** Settings of the hybrid (wave below the crossover, rays above) card. */
export interface HybridSettings extends GeometricEngineSettings {
  /** Parts the run simulates; absent = both. */
  parts?: HybridParts;
  simulation_mode: string; // "mono" | "foa"
  /** 'schroeder': crossover_factor x the room's Schroeder frequency; 'manual': crossover_hz. */
  crossover_mode: 'schroeder' | 'manual';
  crossover_hz: number;
  crossover_factor: number;
  /** Scale the wave part so both parts have the same level around the crossover. */
  level_match: boolean;
  /** Wave part: points per wavelength at its top frequency. */
  ppw: number;
  /** Wave part: IR length in s; null = from the room's decay time. */
  duration: number | null;
  /** Wave part: solver precision. */
  precision: PffdtdPrecision;
  // Geometric part (same meaning as on the ray-tracing card)
  max_order: number;
  ray_tracing: boolean;
  n_rays: number;
  air_absorption: boolean;
  parallel: boolean;
}

/** What a finished hybrid run reports about its crossover (results JSON `hybrid` block). */
export interface HybridRunInfo {
  crossover_hz: number;
  wave_fmax: number;
  schroeder_hz: number | null;
  rt60: number | null;
  volume_m3: number | null;
  mode: string;
  factor: number;
  limited_by: string | null;
  notes: string[];
  /** Where `rt60` (the decay the crossover was planned with) came from */
  rt60_source?: string;
  /** The decay measured on the run's geometric responses, and its Schroeder frequency: the next run plans with them */
  measured_rt60?: number | null;
  measured_schroeder_hz?: number | null;
  wave_duration_s?: number;
  /** Points per wavelength the wave part ran at (raised above the card's when the grid needed it). */
  wave_ppw?: number;
  level_match?: boolean;
  filter?: string;
  median_overlap_mismatch_db?: number | null;
  /** Parts the run simulated (absent = both, joined). */
  parts?: HybridParts;
  /** The wave part ran fitted parameters instead of the card's (absent = ran as set). */
  wave_adjustment?: HybridWaveAdjustment;
}

/** A parameter set the hybrid's wave part can run with (backend utils/hybrid_wave_fit.py). */
export interface HybridWaveOption {
  /** conservative: keeps the wave part's accuracy; optimized: keeps more of the band in the wave solver. */
  key: 'conservative' | 'optimized';
  label: string;
  detail: string;
  /** Card settings to adopt: the handle value (crossover, or the wave band top alone), PPW, precision. */
  crossover_hz: number;
  ppw: number;
  precision: PffdtdPrecision;
  /** What the run then uses: the wave solver's top frequency, points per wavelength after refinement, cell (m). */
  wave_fmax: number;
  run_ppw: number;
  h: number;
  gpu_gb: number;
  budget_gb: number;
  runtime_s: number;
}

/**
 * Why the hybrid's wave part could not run as set (grid too large for the GPU, a source / listener
 * near a surface), the options that run, and which one the job runs (`applied`; null = none runs).
 */
export interface HybridWaveAdjustment {
  reason: 'gpu' | 'clearance';
  message: string;
  requested: { crossover_hz: number; ppw: number; precision: PffdtdPrecision };
  options: HybridWaveOption[];
  recommended: HybridWaveOption['key'] | null;
  applied: HybridWaveOption['key'] | null;
}

/**
 * Hybrid wave-based + geometric simulation: PFFDTD below a crossover frequency (default the
 * room's Schroeder frequency), compas_acoustics above. Same card shape as the other engines.
 */
export interface HybridSimulationConfig extends BaseSimulationConfig, CardExecutionState {
  type: 'hybrid';
  settings: HybridSettings;
  faceToMaterialMap: Map<number, string>;
  expandedMaterialItems?: Set<string>;
  excludedLayers?: Set<string>;
  savedSettings?: {
    settings: HybridSettings;
    faceToMaterialMap: Map<number, string>;
    expandedMaterialItems?: Set<string>;
    excludedLayers?: Set<string>;
  };
  simulationResults: string | null;
  importedIRMetadata?: ImpulseResponseMetadata;
  importedIRIds?: string[];
  sourceReceiverIRMapping?: SourceReceiverIRMapping;
  currentSimulationId?: string | null;
  currentSimulationRunId?: string | null;
  /** Crossover of the last finished run. */
  hybridInfo?: HybridRunInfo | null;
  /** The running job's fitted wave parameters (live from its progress; not saved). */
  waveAdjustment?: HybridWaveAdjustment | null;
  /** 2 = "Hybrid simulation 2": crossover band, per-part settings, geometry check as its own step. */
  uiVersion?: 2;
  speckleMaterialAssignments?: Record<string, string>;
  speckleLayerName?: string | null;
  speckleGeometryObjectIds?: string[];
  speckleScatteringAssignments?: Record<string, number>;
  speckleIsolatedObjectIds?: string[] | null;
  simulationPositions?: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
    soundToPosKey?: Record<string, string>;
    sourceDirectivities?: Record<string, SoundDirectivity>;
    gridListeners?: GridListenerSnapshot[];
  };
}

/** Cards that run a simulation engine on the Speckle geometry (materials, IR mapping, positions). */
export type EngineSimulationConfig = PyroomAcousticsSimulationConfig | PffdtdSimulationConfig | HybridSimulationConfig;

export function isEngineSimulation(config: SimulationConfig | null | undefined): config is EngineSimulationConfig {
  return !!config && (config.type === 'pyroomacoustics' || config.type === 'pffdtd' || config.type === 'hybrid');
}

/** Cards whose geometric part runs on rays (diffraction edges, sound paths). */
export function isGeometricSimulation(
  config: SimulationConfig | null | undefined,
): config is PyroomAcousticsSimulationConfig | HybridSimulationConfig {
  return !!config && (config.type === 'pyroomacoustics' || config.type === 'hybrid');
}

/**
 * Which material columns the Object Explorer shows for a card: 'pyroomacoustics' adds scattering
 * (rays use it), 'pffdtd' shows absorption only. A hybrid card whose rays are off is wave-only.
 */
export function materialColumnsType(config: SimulationConfig | null | undefined): 'pyroomacoustics' | 'pffdtd' | null {
  if (!isEngineSimulation(config)) return null;
  if (config.type === 'hybrid') return config.settings.parts === 'wave' ? 'pffdtd' : 'pyroomacoustics';
  return config.type;
}

/**
 * Manual source-receiver IR import configuration
 */
export interface ImportIRsSimulationConfig extends BaseSimulationConfig {
  type: 'import-irs';
  simulationResults: string | null;
  importedIRIds?: string[];
  sourceReceiverIRMapping?: SourceReceiverIRMapping;
  /**
   * IR import granularity:
   * - 'per-pair' (default): one IR upload slot per source-listener pair.
   * - 'single': one IR upload slot per listener, applied to every source-listener pair.
   */
  irImportMode?: 'single' | 'per-pair';
  simulationPositions?: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
    soundToPosKey?: Record<string, string>;
    /** Directivity of each directional source key at simulation time. */
    sourceDirectivities?: Record<string, SoundDirectivity>;
    /** Grid listener configs at simulation time (for drift detection + reset) */
    gridListeners?: GridListenerSnapshot[];
  };
  /** Advanced settings */
  advancedSettingsExpanded?: boolean;
  materialAssignmentsEnabled?: boolean;
  speckleMaterialAssignments?: Record<string, string>;
  speckleLayerName?: string;
  speckleGeometryObjectIds?: string[];
  speckleScatteringAssignments?: Record<string, number>;
  speckleIsolatedObjectIds?: string[];
  /**
   * Linear peak-offset applied to every assigned IR's peak (-1..1).
   * 0 = unchanged, positive raises peaks toward clipping, negative lowers toward mute.
   */
  irGain?: number;
  irNormalizeEnabled?: boolean;
}

/**
 * Union type for all simulation configs
 */
export type SimulationConfig =
  | ResonanceSimulationConfig
  | PyroomAcousticsSimulationConfig
  | PffdtdSimulationConfig
  | HybridSimulationConfig
  | ImportIRsSimulationConfig;

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
  
  // Material assignment (for Pyroomacoustics)
  availableMaterials?: AcousticMaterial[];
  modelEntities?: any[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  
  // IR Library
  onIRImported?: () => void;
  irRefreshTrigger?: number;
  onSelectIRFromLibrary?: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
}
