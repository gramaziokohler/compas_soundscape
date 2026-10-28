// Import card types
import type { CardType, CardBaseConfig, CardState, CardProps, CardHeaderProps, CardButtonBarProps, CardExecutionState } from './card';
export type { CardType, CardBaseConfig, CardState, CardProps, CardHeaderProps, CardButtonBarProps, CardExecutionState };
export { CARD_TYPE_LABELS } from './card';

// Import and re-export Speckle Scene types
import type { SpeckleSceneProps, SpeckleGeometryNode, RenderStyle } from './speckle-scene';
export type { SpeckleSceneProps, SpeckleGeometryNode, RenderStyle };

// Import and re-export SED types
import type { SEDAudioInfo, DetectedSound, SEDAnalysisResult, SEDAnalysisOptions, SEDUIState, UseSEDReturn } from './sed';
export type { SEDAudioInfo, DetectedSound, SEDAnalysisResult, SEDAnalysisOptions, SEDUIState, UseSEDReturn };

// Import and re-export Receiver types
import type { ReceiverData, ReceiverOverlay, GridListenerData } from './receiver';
export type { ReceiverData, ReceiverOverlay, GridListenerData };

// Import and re-export source directivity types
import type {
  SoundDirectivity,
  DirectivityRecord,
  DirectivityInspectResult,
  DirectivityPreview,
  DirectivityImportStatus,
} from './directivity';
export type { SoundDirectivity, DirectivityRecord, DirectivityInspectResult, DirectivityPreview, DirectivityImportStatus };

// Import and re-export Analysis types
import type {
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalysisConfig,
  TextPromptResult,
  AnalysisResult,
  AnalysisSectionProps,
  SpeechResult,
  OrchestrateResult,
  OrchestrateEntry,
  ScenarioSource,
} from './analysis';
export type {
  AudioAnalysisConfig,
  TextAnalysisConfig,
  AnalysisConfig,
  TextPromptResult,
  AnalysisResult,
  AnalysisSectionProps,
  SpeechResult,
  OrchestrateResult,
  OrchestrateEntry,
  ScenarioSource,
};

// Import and re-export Acoustics types
import type {
  AcousticSimulationMode,
  SimulationState,
  BaseSimulationConfig,
  ResonanceSimulationConfig,
  PyroomAcousticsSimulationConfig,
  PffdtdSimulationConfig,
  SimulationConfig,
  SimulationTabProps
} from './acoustics';
export type {
  AcousticSimulationMode,
  SimulationState,
  BaseSimulationConfig,
  ResonanceSimulationConfig,
  PyroomAcousticsSimulationConfig,
  PffdtdSimulationConfig,
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
  /** Async Speckle file-ingestion job id — poll `/api/speckle/ingestion/{id}` for the version. */
  ingestion_id?: string;
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
  /** Stable identity of the owning config — generated-state matching key. */
  config_id?: string;
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
  /** Foley FX chain authored in the sound editor. */
  fx?: import('@/lib/audio/fx/fx-types').FxChain;
  /** Bounced WAV produced by the last Save in the sound editor. */
  fx_url?: string;
  /** When true, playback / waveforms / export use `fx_url` instead of `url`. */
  fx_enabled?: boolean;
  /**
   * Generation inputs this variant was made from (see
   * `utils/generationSignature.captureVariantSignature`). Loaded into the card's
   * settings editor when the variant is selected.
   */
  generated_signature?: string;
  /**
   * Radiation pattern + orientation of this source (undefined = omnidirectional).
   * Shared by the variants of one prompt like `position`; part of the simulation
   * source key (utils/positionKey.ts).
   */
  directivity?: SoundDirectivity;
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
  /** Layer path of the entity, used as a fallback identity when applicationId changes. */
  layer?: string;
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
  /** Stable identity for this card — survives index reshuffles and model switches.
   *  Generated events carry the same `config_id`; never rely on array position. */
  config_id?: string;
  duration: number;
  /** Classifier-free guidance. TangoFlux/AudioLDM2: 0-10; Stable Audio 3: 0-1 (default 0.9). */
  guidance_scale?: number;
  /** ElevenLabs `prompt_influence` (0–1). Ignored by TangoFlux (uses guidance_scale). */
  prompt_influence?: number;
  /** ElevenLabs seamless looping. Defaults to true at generation time for background beds. */
  loop?: boolean;
  /**
   * Background cards only: play as a global (non-spatial) bed — no direction or
   * distance attenuation, still convolved by the room — with its sphere hidden.
   * Unset = GLOBAL_SOURCE.DEFAULT_ENABLED. Playback-only: not a generation input.
   */
  global_playback?: boolean;
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
  /** Source directivity + orientation, copied onto the events this card generates. */
  directivity?: SoundDirectivity;
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
  /** Scenario pipeline reference for an "incomplete" card (foley+speech only, pre-orchestrate). */
  scenarioSource?: import('./analysis').ScenarioSource;
  /** Generation-input snapshot captured when the card was generated (see `utils/generationSignature.ts`). Transient. */
  generatedSignature?: string;
}

/** Options of one sound-generation invocation (several may run concurrently). */
export interface GenerateSoundsOptions {
  /** Regenerate already-generated targets too (their events are replaced). */
  force?: boolean;
  /** Text-to-audio model for this invocation only (defaults to the app-wide setting). */
  audioModel?: string;
}

/** Result of one sound-generation invocation. */
export interface GenerateSoundsOutcome {
  /** Why the invocation failed or stopped, or null. */
  error: string | null;
}

/** A sound selected from the Google Sound Library catalog */
export interface CatalogSoundSelection {
  name: string;
  url: string;
  category: string;
}

// ─── Job persistence types ────────────────────────────────────────────────────

export type JobType = 'sound' | 'tts' | 'sed' | 'pyroom' | 'pffdtd' | 'llm' | 'loop';

export interface JobRecord {
  jobId: string;
  jobType: JobType;
  timestamp: number;
  meta?: {
    configIndex?: number;
    kind?: string;
    scenarioId?: string;
    /** pyroom: the simulation config id the job belongs to (stable across reorder/reload). */
    configId?: string;
    /** pyroom: which simulation instance card the job belongs to. */
    instanceId?: string;
    /** pyroom: Speckle version submitted for simulation (tagged on the recovered result). */
    versionId?: string;
    /** loop: which sound the loop region applies to. */
    soundId?: string;
    /** sound/tts: the backend-echoed `prompt_index` (batch index for sound, card
     *  index for tts) → owning card's `config_id`, so recovery re-keys results
     *  onto the same config-keyed ids the live path assigns. */
    configIdByPromptIndex?: Record<number, string>;
    /** Model the job was submitted for — lets other members' browsers (and other
     *  models of the same workspace) ignore jobs that belong elsewhere. */
    modelId?: string;
  };
}

export type SoundState = 'playing' | 'paused' | 'stopped';

// Per-user preferences (Advanced Settings)
import type { UserPreferences, ListenerOrientation } from './preferences';
export type {
  TtsLanguageMatchKind,
  TtsDialect,
  TtsCustomVoice,
  TtsDialectsResponse,
  TtsLanguageMatch,
  TtsCustomVoiceCreateRequest,
} from './ttsLanguage';
export type { UserPreferences, ListenerOrientation };

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

// Simulation geometry preflight types
export type {
  SimulationEngine,
  SimulationMeshSettings,
  PreflightSeverity,
  PreflightIssue,
  PreflightFaceClass,
  PreflightSeedStatus,
  PreflightSeed,
  PreflightLoop,
  PreflightLeakRay,
  PreflightBlockedPath,
  PreflightStats,
  PreflightPayload,
  PreflightJobResult,
  PreflightViewMode,
  PreflightFilters,
  PreflightRunStatus,
  PreflightEntry,
} from './simulationPreflight';
export { PREFLIGHT_FACE_CLASS } from './simulationPreflight';

// In-app bug reports
export type {
  BugReportCategory,
  BugReportLogLevel,
  BugReportLogEntry,
  BugReportFailedRequest,
  BugReportContext,
  BugReportPayload,
  BugReportCreated,
} from './bugReport';

// Research-study interaction logging
export type {
  StudyJson,
  StudyPayload,
  StudyFeatures,
  StudyConfig,
  StudyEvent,
  StudyEventBatch,
  StudySnapshotUpload,
  StudyMomentCreate,
  StudyMomentNote,
  StudyListenerKind,
  StudyListenerState,
  StudyIntentKind,
  StudyIntentPrompt,
  StudyPromptedByListening,
} from './study';

// Send sound scenes to another model
export type { SendScenesRequest, SendScenesResponse, SendTargetEntry } from './sceneTransfer';
export type {
  PffdtdStatus,
  PffdtdSettings,
  PffdtdJobResult,
  PffdtdFieldBlock,
  PffdtdFieldSource,
  PffdtdFieldVolume,
  PffdtdFieldVolumeSource,
  PffdtdSlice,
  PffdtdSliceAxis,
  PffdtdTexelGrid,
  PffdtdResultsJson,
  PffdtdVoxelPreviewPayload,
  PffdtdVoxelPreviewJobResult,
  PffdtdVoxelPoints,
  PffdtdVoxelProblem,
  PffdtdOverlayKind,
} from './pffdtd';
