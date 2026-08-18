/**
 * Soundscape Data Persistence Types
 *
 * TypeScript interfaces matching the backend Pydantic schemas for
 * saving/loading soundscape state to/from Speckle + local storage.
 */

/** Global generation settings for a soundscape session */
export interface SoundscapeGlobalSettings {
  duration: number;
  steps: number;
  negative_prompt: string;
  audio_model: string;
}

/** Serializable sound configuration (one card) */
export interface SoundscapeSoundConfig {
  index: number;
  prompt: string;
  type?: string; // CardType: "text-to-audio", "upload", "library"
  duration: number;
  display_name?: string;
  dbfs?: number;
  interval_seconds?: number;
  /** @deprecated use entity_indices instead */
  entity_index?: number;
  /** @deprecated use entity_node_ids instead */
  entity_node_id?: string; // Full Speckle object hash ID for entity matching
  entity_indices?: number[];     // All linked entity indices
  entity_node_ids?: string[];    // Stable applicationIds for all linked entities
  seed_copies: number;
  steps: number;
  /** Parent analysis card index (links this sound config back to its context/usage card) */
  parent_usage_original_index?: number;
  /** Orchestration metadata (parametric trigger links between sounds) — persisted so the
   *  parametric schedule can be reconstructed, re-baked and edited after load. */
  orchestrate_meta?: SoundscapeOrchestrateMeta;
  /** Sound category from foley/scenario analysis (e.g. "background", "sound_event", "speech"). */
  category?: string;
}

/** Serializable orchestration metadata (parametric trigger links). */
export interface SoundscapeOrchestrateMeta {
  orchestrateId: string;
  entryId: string;
  trigger: { type: string; expression: string[]; delay: number[] };
  variants: number[];
  allObjectIds: string[];
  speechLines?: string[];
  isSpeech?: boolean;
  voiceName?: string;
  timestamps?: string[];
}

/** Serializable per-iteration link (variant + entity), keyed by `${soundId}-${iterationIndex}`. */
export interface SoundscapeIterationLink {
  variantIndex?: number;
  entityNodeId?: string;
  entityPosition?: [number, number, number];
  entityIndex?: number;
}

/** Serializable sound event (generated/uploaded sound placed in 3D) */
export interface SoundscapeSoundEvent {
  id: string;
  audio_filename: string; // filename only, not full URL
  position: number[]; // [x, y, z]
  display_name?: string;
  prompt?: string;
  prompt_index?: number;
  volume_dbfs?: number;
  current_volume_dbfs?: number;
  interval_seconds?: number;
  current_interval_seconds?: number;
  is_uploaded: boolean;
  /** @deprecated use entity_indices instead */
  entity_index?: number;
  entity_node_id?: string; // Full Speckle object hash ID for entity matching
  entity_indices?: number[];  // All linked entity indices
  /** Per-track timeline scheduling mode (defaults to "timestamps" on load when absent). */
  scheduling_mode?: 'interval' | 'timestamps';
  /** Explicit per-track start times in seconds (used when scheduling_mode is "timestamps"). */
  timestamps?: number[];
  /** Sound category from foley/scenario analysis (e.g. "background", "sound_event", "speech"). */
  category?: string;
  /** 0-based copy index for multi-variant sounds (distinguishes variants of the same prompt). */
  copy_index?: number;
}

/** Serializable receiver position */
export interface SoundscapeReceiver {
  id: string;
  name: string;
  position: number[]; // [x, y, z]
  type?: string;
  yaw?: number;
  pitch?: number;
  roll?: number;
  orientation_saved?: boolean;
}

/** Serializable grid listener configuration */
export interface SoundscapeGridListener {
  id: string;
  name: string;
  xSpacing: number;
  ySpacing: number;
  zOffset: number;
  showListeners: boolean;
  hiddenForSimulation: boolean;
  selectedObjectIds: string[];
  boundingBox: { min: number[]; max: number[] } | null;
  points: number[][];
}

/** Serializable impulse response metadata for persistence */
export interface SoundscapeIRMetadata {
  id: string;
  url: string;
  filename: string; // Filename only, used for persistent copy
  name: string;
  format: string; // "mono", "binaural", "foa", "toa"
  channels: number;
  original_channels: number;
  sample_rate: number;
  duration: number;
  file_size: number;
  normalization_convention?: string;
  channel_ordering?: string;
}

/** Serializable pyroomacoustics simulation settings */
export interface SoundscapeSimulationSettings {
  max_order: number;
  ray_tracing: boolean;
  air_absorption: boolean;
  n_rays: number;
  simulation_mode: string;
  enable_grid: boolean;
}

/** Serializable simulation configuration */
export interface SoundscapeSimulationConfig {
  id: string;
  display_name: string;
  type: string; // "pyroomacoustics", "choras", "resonance", "import-irs"
  state: string;
  simulation_instance_id?: string;
  settings?: SoundscapeSimulationSettings;
  speckle_material_assignments?: Record<string, string>;
  speckle_layer_name?: string;
  speckle_geometry_object_ids?: string[];
  speckle_scattering_assignments?: Record<string, number>;
  simulation_results?: string;
  current_simulation_id?: string;
  imported_ir_ids?: string[];
  source_receiver_ir_mapping?: Record<string, Record<string, SoundscapeIRMetadata>>;
  receiver_positions?: Record<string, number[]>; // receiverId -> [x, y, z]
  simulation_positions?: {
    sources: Record<string, number[]>; // posKey -> [x, y, z]
    receivers: Record<string, number[]>; // receiverId -> [x, y, z]
    sound_to_pos_key?: Record<string, string>; // soundId -> posKey
    grid_listeners?: Array<{
      id: string;
      name: string;
      xSpacing: number;
      ySpacing: number;
      zOffset: number;
      selectedObjectIds: string[];
      boundingBox: { min: number[]; max: number[] } | null;
      points: number[][];
    }>; // grid configs at simulation time (for drift detection + reset)
  };
  ir_gain_db?: number;
  ir_normalize_enabled?: boolean;
  material_assignments_enabled?: boolean;
  ir_import_mode?: 'single' | 'per-pair';
}

/** ShoeBox Acoustics room configuration (global) */
export interface SoundscapeResonanceAudioConfig {
  enabled: boolean;
  ambisonic_order?: number;
  room_dimensions: { width: number; height: number; depth: number };
  room_materials: { left: string; right: string; front: string; back: string; down: string; up: string };
}

/** Full soundscape data package */
export interface SoundscapeData {
  version: string;
  model_id: string;
  model_name: string;
  project_id?: string;
  version_id?: string;
  auth_token?: string;
  created_at: string; // ISO datetime
  global_settings: SoundscapeGlobalSettings;
  sound_configs: SoundscapeSoundConfig[];
  sound_events: SoundscapeSoundEvent[];
  // Simulation persistence (all optional, backward-compatible)
  receivers?: SoundscapeReceiver[];
  grid_listeners?: SoundscapeGridListener[];
  selected_receiver_id?: string;
  simulation_configs?: SoundscapeSimulationConfig[];
  active_simulation_index?: number;
  // Analysis state persistence
  analysis_state?: AnalysisState;
  // Resonance audio persistence
  resonance_audio_config?: SoundscapeResonanceAudioConfig;
  // Per-iteration variant/entity links (keyed by `${soundId}-${iterationIndex}`)
  iteration_links?: Record<string, SoundscapeIterationLink>;
  /** Sound IDs currently muted in the DAW timeline. */
  muted_sounds?: string[];
  /** Sound ID currently soloed in the DAW timeline (null = none). */
  soloed_sound?: string | null;
}

/** Request payload for POST /api/speckle/soundscape/save */
export interface SoundscapeSavePayload {
  soundscape_data: SoundscapeData;
  audio_urls: string[];
  ir_urls: string[];
  analysis_ids?: string[];
  scenario_ids?: string[];
}

/** Response from POST /api/speckle/soundscape/save */
export interface SoundscapeSaveResponse {
  success: boolean;
  speckle_object_id?: string;
  local_folder?: string;
  audio_files_copied: number;
  ir_files_copied: number;
  message: string;
}

/** Response from GET /api/speckle/soundscape/{model_id} */
export interface SoundscapeLoadResponse {
  soundscape_data: SoundscapeData | null;
  audio_base_url: string;
  ir_base_url: string;
  found: boolean;
}

/** Response from GET /api/speckle/soundscape/{model_id}/stats */
export interface SoundscapeStats {
  model_id: string;
  found: boolean;
  sound_configs: number;
  sound_events: number;
  receivers: number;
  simulation_configs: number;
  analysis_cards: number;
  audio_files: number;
  audio_size_bytes: number;
  audio_size_formatted: string;
  ir_files: number;
  ir_size_bytes: number;
  ir_size_formatted: string;
  analysis_files: number;
  simulation_result_files: number;
  total_size_bytes: number;
  total_size_formatted: string;
  last_modified: string | null;
  created_at: string | null;
  model_name: string;
}

// ============================================================================
// Analysis State Persistence Types
// ============================================================================

/** Serializable subset of an AnalysisConfig for save/restore within soundscape.json */
export interface SerializedAnalysisConfig {
  type: string;
  display_name?: string;
  parentContextOriginalIndex?: number;
  numSounds?: number;
  textInput?: string;
  userContext?: string;
  useModelAsContext?: boolean;
  useAnalysisResult?: boolean;
  peopleCount?: number;
  likeliness?: number;
  analysisOptions?: Record<string, boolean>;
  applyNoiseReduction?: boolean;
  // 3D model analysis result (strip raw from entities)
  analysisResult?: {
    analysisId: string;
    architecturalObjects: Array<{
      name: string;
      description: string;
      material: string;
      confidence: number;
      quantity: number;
      object_ids: Record<string, { min_bounds?: number[]; max_bounds?: number[] }>;
    }>;
    /** Short 1-3 word LLM-generated title for the analyzed space. */
    spaceTitle?: string;
    /** Natural-language description of the space from the analysis. */
    spaceDescription?: string;
  };
  // 3D-model card: selected diverse entities (strip raw)
  selectedDiverseEntities?: Array<{
    id: string;
    index: number;
    type: string;
    name: string;
    layer: string;
    speckle_type: string;
    nodeId: string;
    bounds?: { min: number[]; max: number[]; center: number[] };
  }>;
  // Scenario/foley state
  scenarioResult?: any;
  scenarioId?: string | null;
  foleyResult?: any;
  selectedFoleyKeys?: string[];
  // Hierarchical: generated prompts for this analysis card
  prompts?: Array<{
    id: string;
    text: string;
    displayName?: string;
    selected: boolean;
    entities?: any[];
    position?: [number, number, number];
    metadata?: Record<string, unknown>;
  }>;
  // Direct sound configs created from this analysis card's prompts
  // (indices into the top-level soundscape.sound_configs array)
  sound_config_indices?: number[];
}

/** Analysis state stored inside soundscape.json */
export interface AnalysisState {
  active_tab: number;
  configs: SerializedAnalysisConfig[];
  pending_sound_configs?: any[];
  /** Breadcrumb navigation state: which context/usage cards have children */
  card_flow?: {
    contextAdvanced: number[];
    usageAdvanced: number[];
    contextToUsageMap: Record<number, number[]>;
    usageToSoundMap: Record<number, number[]>;
  };
}
