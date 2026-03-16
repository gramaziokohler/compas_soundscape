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
  spl_db?: number;
  interval_seconds?: number;
  entity_index?: number;
  seed_copies: number;
  steps: number;
}

/** Serializable sound event (generated/uploaded sound placed in 3D) */
export interface SoundscapeSoundEvent {
  id: string;
  audio_filename: string; // filename only, not full URL
  position: number[]; // [x, y, z]
  display_name?: string;
  prompt?: string;
  prompt_index?: number;
  volume_db?: number;
  current_volume_db?: number;
  interval_seconds?: number;
  current_interval_seconds?: number;
  is_uploaded: boolean;
  entity_index?: number;
}

/** Serializable receiver position */
export interface SoundscapeReceiver {
  id: string;
  name: string;
  position: number[]; // [x, y, z]
  type?: string;
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
  type: string; // "pyroomacoustics", "choras", "resonance"
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
}

/** Full soundscape data package */
export interface SoundscapeData {
  version: string;
  model_id: string;
  model_name: string;
  created_at: string; // ISO datetime
  global_settings: SoundscapeGlobalSettings;
  sound_configs: SoundscapeSoundConfig[];
  sound_events: SoundscapeSoundEvent[];
  // Simulation persistence (all optional, backward-compatible)
  receivers?: SoundscapeReceiver[];
  selected_receiver_id?: string;
  simulation_configs?: SoundscapeSimulationConfig[];
  active_simulation_index?: number;
}

/** Request payload for POST /api/speckle/soundscape/save */
export interface SoundscapeSavePayload {
  soundscape_data: SoundscapeData;
  audio_urls: string[];
  ir_urls: string[];
}

/** Response from POST /api/speckle/soundscape/save */
export interface SoundscapeSaveResponse {
  success: boolean;
  speckle_object_id?: string;
  local_folder?: string;
  json_path?: string;
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
