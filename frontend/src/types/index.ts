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
import type { ReceiverData, ReceiverOverlay } from './receiver';
export type { ReceiverData, ReceiverOverlay };

// Import and re-export Analysis types
import type {
  ModelAnalysisConfig,
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalysisConfig,
  TextPromptResult,
  AnalysisResult,
  AnalysisSectionProps
} from './analysis';
export type {
  ModelAnalysisConfig,
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalysisConfig,
  TextPromptResult,
  AnalysisResult,
  AnalysisSectionProps
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
  volume_db?: number; // SPL level in dB
  current_volume_db?: number; // Current volume override (user-adjustable)
  interval_seconds?: number; // Playback interval in seconds
  current_interval_seconds?: number; // Current interval override (user-adjustable)
  isUploaded?: boolean; // Flag indicating this sound was uploaded (not generated)
  entity_index?: number; // Index of the entity this sound is linked to (for entity-based sounds)
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
  entity?: any;
  display_name?: string;
  spl_db?: number; // SPL level from LLM estimation
  interval_seconds?: number; // Playback interval from LLM estimation
  type?: CardType; // Card type from CardType (single source of truth)
  // Uploaded audio fields (when bypassing generation)
  uploadedAudioBuffer?: AudioBuffer; // Audio buffer for playback
  uploadedAudioInfo?: SEDAudioInfo; // Audio metadata for display
  uploadedAudioUrl?: string; // Object URL for fetching audio data
  // Library search fields
  librarySearchState?: LibrarySearchState; // State for library search results
  selectedLibrarySound?: LibrarySearchResult; // Selected sound from library
}

export type SoundState = 'playing' | 'paused' | 'stopped';

// Import SidebarTabValue from constants for single source of truth
import type { SidebarTabValue } from '@/lib/constants';

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
