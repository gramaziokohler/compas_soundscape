// Import card types
import type { CardType, CardBaseConfig, CardState, CardProps, CardHeaderProps, CardButtonBarProps, CardExecutionState } from './card';
export type { CardType, CardBaseConfig, CardState, CardProps, CardHeaderProps, CardButtonBarProps, CardExecutionState };
export { CARD_TYPE_LABELS } from './card';

// Import and re-export Speckle Scene types
import type { SpeckleSceneProps, SpeckleGeometryNode } from './speckle-scene';
export type { SpeckleSceneProps, SpeckleGeometryNode };

// Import and re-export SED types
import type { SEDAudioInfo, DetectedSound, SEDAnalysisResult, SEDAnalysisOptions, SEDUIState, UseSEDReturn } from './sed';
export type { SEDAudioInfo, DetectedSound, SEDAnalysisResult, SEDAnalysisOptions, SEDUIState, UseSEDReturn };

// Import and re-export Receiver types
import type { ReceiverData, ReceiverOverlay, GridListenerData } from './receiver';
export type { ReceiverData, ReceiverOverlay, GridListenerData };

// Import and re-export Analysis types
import type {
  ModelAnalysisConfig,
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalysisConfig,
  TextPromptResult,
  AnalysisResult,
  AnalysisSectionProps,
  SpeechResult,
  OrchestrateResult,
  OrchestrateEntry,
} from './analysis';
export type {
  ModelAnalysisConfig,
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalysisConfig,
  TextPromptResult,
  AnalysisResult,
  AnalysisSectionProps,
  SpeechResult,
  OrchestrateResult,
  OrchestrateEntry,
};

// Import and re-export Acoustics types
import type {
  AcousticSimulationMode,
  SimulationState,
  BaseSimulationConfig,
  ResonanceSimulationConfig,
  ChorasSimulationConfig,
  PyroomAcousticsSimulationConfig,
  SimulationConfig,
  SimulationTabProps
} from './acoustics';
export type {
  AcousticSimulationMode,
  SimulationState,
  BaseSimulationConfig,
  ResonanceSimulationConfig,
  ChorasSimulationConfig,
  PyroomAcousticsSimulationConfig,
  SimulationConfig,
  SimulationTabProps
};

// Type Definitions
export interface CompasGeometry {
  vertices: number[][];
  faces: number[][];
  face_entity_map?: number[];  // Maps face index to entity index
}

// Speckle upload response
export interface SpeckleUploadData {
  model_id: string;
  version_id: string;
  file_id: string;
  url: string;
  object_id: string;
  auth_token?: string;
}

// File upload response (supports both legacy and Speckle)
export interface FileUploadResponse {
  geometry?: CompasGeometry;
  speckle?: SpeckleUploadData;
}

export interface SoundEvent {
  id: string;
  url: string;
  position: [number, number, number];
  geometry: CompasGeometry;
  display_name?: string;
  prompt?: string;
  prompt_index?: number;
  total_copies?: number;
  volume_dbfs?: number; // Level in dBFS (0 = full scale, negative = quieter)
  current_volume_dbfs?: number; // Current volume override (user-adjustable)
  interval_seconds?: number; // Playback interval in seconds
  current_interval_seconds?: number; // Current interval override (user-adjustable)
  isUploaded?: boolean; // Flag indicating this sound was uploaded (not generated)
  entity_index?: number; // Primary entity index (entities[0].index) — kept for sphere-manager backward compat
  entity_indices?: number[]; // All linked entity indices (multi-entity support)
  /** Explicit playback timestamps in "MM:SS" format (from foley/scenario JSON). */
  timestamps?: string[];
  /** Default scheduling mode hint carried from source data. */
  scheduling_mode?: 'interval' | 'timestamps';
  /** True for pre-generation placeholder spheres (no audio, lighter color). */
  isPending?: boolean;
  /** Sound category from foley/scenario analysis (e.g. "background", "sound_event", "speech") */
  category?: string;
}

export interface UIOverlay {
  promptKey: string;
  promptIdx: number;
  x: number;
  y: number;
  visible: boolean;
  userHidden?: boolean; // User-toggled visibility (separate from camera visibility)
  soundId: string;
  displayName: string;
  variants: SoundEvent[];
  selectedVariantIdx: number;
  isEntityLinked?: boolean; // Flag indicating this overlay is linked to an entity (no sphere, no drag)
  distance?: number; // Distance from camera to sound source in meters
}

export interface EntityData {
  index: number;
  type: string;
  name?: string;
  layer?: string;
  material?: string;
  position: number[];
  bounds: {
    min: number[];
    max: number[];
    center?: number[];
  };
}

/** Shape of a linked 3D entity (Speckle object or Three.js entity) */
export interface SoundEntity {
  index?: number;
  type?: string;
  name?: string;
  position?: number[];
  bounds?: {
    min?: number[];
    max?: number[];
    center?: number[];
  };
  nodeId?: string;
  id?: string;
  applicationId?: string;
  speckle_type?: string;
  geometry?: any;
  /** Foley fallback position used when viewer can't resolve bounds */
  foleyPosition?: [number, number, number];
  [key: string]: any;
}

export interface EntityOverlay {
  x: number;
  y: number;
  visible: boolean;
  entity: EntityData;
  soundOverlay?: UIOverlay; // Optional sound overlay data when entity has linked sound
  linkedPromptIndex?: number; // Prompt index of linked sound (if any)
}

export interface SoundGenerationConfig {
  prompt: string;
  duration: number;
  guidance_scale?: number; // Optional: not used in SED workflow
  negative_prompt: string;
  seed_copies: number;
  steps: number;
  /** @deprecated use entities[] instead */
  entity?: any;
  entities?: SoundEntity[];
  display_name?: string;
  dbfs?: number; // Level in dBFS from LLM estimation
  interval_seconds?: number; // Playback interval from LLM estimation
  type?: CardType; // Card type from CardType (single source of truth)
  error?: string | null; // Per-card error message
  /** Explicit playback timestamps in "MM:SS" format (from foley/scenario JSON). */
  timestamps?: string[];
  /** Manual position override for pre-generation sphere placement. */
  position?: [number, number, number];
  // Uploaded audio fields (when bypassing generation)
  uploadedAudioBuffer?: AudioBuffer; // Audio buffer for playback
  uploadedAudioInfo?: SEDAudioInfo; // Audio metadata for display
  uploadedAudioUrl?: string; // Object URL for fetching audio data
  // Library search fields
  librarySearchState?: LibrarySearchState; // State for library search results
  selectedLibrarySound?: LibrarySearchResult; // Selected sound from library
  // Catalog (Google Sound Library) fields
  selectedCatalogSound?: CatalogSoundSelection; // Selected sound from catalog
  catalogSelectedCategory?: { id: string; name: string }; // Persisted category selection for undo
  /** Original index of the usage card that generated this sound config (for parent-child filtering) */
  parentUsageOriginalIndex?: number;
  /** Sound category from foley/scenario analysis (e.g. "background", "sound_event", "speech") */
  category?: string;
  /** TTS voice name (Gemini prebuilt voices: Kore, Fenrir, Puck, etc.) */
  voice_name?: string;
  /** Orchestration metadata from the pipeline (foley+speech → orchestrate) */
  orchestrateMeta?: {
    orchestrateId: string;
    entryId: string;
    trigger: { type: string; expression: string[]; delay: number[] };
    variants: number[];
    allObjectIds: string[];
    speechLines?: string[];
    isSpeech?: boolean;
    voiceName?: string;
    /** Original foley/speech timestamps (MM:SS) — fallback when trigger resolution fails. */
    timestamps?: string[];
  };
}

/** A sound selected from the Google Sound Library catalog */
export interface CatalogSoundSelection {
  name: string;
  url: string;
  category: string;
}

// ─── Job persistence types ────────────────────────────────────────────────────

export type JobType = 'sound' | 'tts' | 'llm' | 'sed' | 'choras' | 'pyroom' | 'model_analysis';

export interface JobRecord {
  jobId: string;
  jobType: JobType;
  timestamp: number;
}

export type SoundState = 'playing' | 'paused' | 'stopped';

// Import SidebarTabValue from constants for single source of truth
import type { SidebarTabValue } from '@/utils/constants';

/** Active sidebar tab - uses SidebarTabValue from constants */
export type ActiveTab = SidebarTabValue;
export type LoadTab = 'sample' | 'upload';

// Sound generation mode types - deprecated, use CardType instead
/** @deprecated Use CardType instead */
export type SoundGenerationMode = 'text-to-audio' | 'upload' | 'library' | 'sample-audio';

// Library search types
export interface LibrarySearchResult {
  location: string;
  description: string;
  category: string;
  duration: string;
  score: number;
}

export interface LibrarySearchState {
  isSearching: boolean;
  results: LibrarySearchResult[];
  selectedSound: LibrarySearchResult | null;
  error: string | null;
}
