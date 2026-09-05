/**
 * Analysis Types
 *
 * Types for the Analysis section that manages three types of context analysis:
 * - 3D Model context (geometry_service.py)
 * - Audio context (sed_service.py)
 * - Text context (llm_service.py)
 */

import type { SEDAudioInfo, SEDAnalysisOptions } from './sed';
import type { CardBaseConfig, CardType } from './card';

// ============================================================================
// Analysis Config Types
// ============================================================================

/**
 * Base analysis config (extends CardBaseConfig)
 */
export interface AnalysisBaseConfig extends CardBaseConfig {
  type: CardType;
  /** Original index of the context card that generated this usage card (for parent-child filtering) */
  parentContextOriginalIndex?: number;
  /** Per-card config-validation error message, rendered as an inline Notice bar (not a toast) */
  error?: string | null;
}

/**
 * 3D Model Analysis Config
 */
export interface ModelAnalysisConfig extends AnalysisBaseConfig {
  type: '3d-model';
  modelFile: File | null;
  modelEntities: any[];
  selectedDiverseEntities: any[];
  useModelAsContext: boolean;
  geometryData?: any;
  liveScreenshots?: string[];
  speckleData?: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
  };
}

/**
 * Audio Analysis Config
 */
export interface AudioAnalysisConfig extends AnalysisBaseConfig {
  type: 'audio';
  audioFile: File | null;
  audioInfo: SEDAudioInfo | null;
  audioBuffer: AudioBuffer | null;
  analysisOptions: SEDAnalysisOptions;
  /** Whether to apply noise reduction when extracting SED audio segments */
  applyNoiseReduction?: boolean;
  /** Basename of the source audio persisted under data/soundscapes/<session>/audio/ so the
   *  SED waveform + detected-sounds results can be reconstructed after a page refresh. */
  persistedAudioFilename?: string;
}

/**
 * Text Analysis Config
 */
export interface TextAnalysisConfig extends AnalysisBaseConfig {
  type: 'text';
  textInput: string;
  useModelAsContext: boolean;
}

/**
 * Architectural object identified by model analysis
 */
export interface ArchitecturalObject {
  name: string;
  description: string;
  material: string;
  quantity: number;
  /** Dict keyed by Speckle hex ID → optional bounds from backend.
   *  Use Object.keys(object_ids) to obtain the flat ID list. */
  object_ids: Record<string, { min_bounds?: number[]; max_bounds?: number[] }>;
}

/**
 * Result data from model analysis
 */
export interface ModelAnalysisResultData {
  analysisId: string;
  architecturalObjects: ArchitecturalObject[];
  spaceTitle?: string;
  spaceDescription?: string;
}

/**
 * Analyze 3D Model Config — streaming architectural object identification
 */
export interface AnalyzeModelConfig extends AnalysisBaseConfig {
  type: 'model-analysis';
  liveScreenshots: string[];
  liveScreenshotFilenames: string[];
  userContext: string;
  modelEntities: any[];
  speckleData?: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
  };
  analysisResult?: ModelAnalysisResultData;
}

/**
 * Union type for all analysis configs
 */
export type AnalysisConfig = ModelAnalysisConfig | AudioAnalysisConfig | TextAnalysisConfig | AnalyzeModelConfig | ScenarioConfig | FreeformConfig;

// ============================================================================
// Freeform Config
// ============================================================================

/**
 * Freeform (placeholder) config — no analysis, just a named card that lets
 * the user proceed directly through the workflow without running any analysis.
 * Used for "Skip context" (context section) and "Skip usage" (usage section).
 */
export interface FreeformConfig extends AnalysisBaseConfig {
  type: 'freeform';
}

// ============================================================================
// Scenario Types
// ============================================================================

export interface ScenarioEventItem {
  timestamp: string;
  description: string;
}

export interface ScenarioItem {
  title: string;
  duration: string;
  peopleCount: number;
  likeliness: number;
  events: ScenarioEventItem[];
}

export interface ScenarioResult {
  scenarios: ScenarioItem[];
  scenarioId: string;
}

export interface FoleySoundEvent {
  id: string;
  soundName: string;
  description: string;
  duration: string;
  timestamps: string[];
  category: string;
  objectsInvolved: string[];
  position: number[];
  spl: string;
}

export interface FoleyScenario {
  scenario_title: string;
  sound_events: FoleySoundEvent[];
}

export interface FoleyResult {
  scenarios: FoleyScenario[];
  foleyId: string;
}

export interface SpeechEntry {
  id: string;
  timestamps: string[];
  character: string;
  script: string;
  position: number[];
}

export interface SpeechResult {
  speeches: SpeechEntry[];
  speechId: string;
}

export interface OrchestrateTrigger {
  type: string;
  expression: string[];
  delay: number[];
}

export interface OrchestrateEntry {
  id: string;
  soundName: string;
  description: string;
  category: string;
  duration: string;
  trigger: OrchestrateTrigger;
  /** Original foley/speech timestamps (MM:SS), one per trigger expression slot. */
  timestamps: string[];
  /** TTS voice label for speech entries (e.g. "Clara"); empty for foley. */
  character: string;
  objectsInvolved: string[];
  position: number[];
  variants: number[];
  spl: string;
}

export interface OrchestrateResult {
  playlist: OrchestrateEntry[];
  orchestrateId: string;
}

/**
 * Reference a sound card carries back to the scenario pipeline (scenario + foley +
 * speech) that produced it, so orchestration can be re-run at generation time from
 * the user's edited cards. Carries the raw foley/speech entry fields needed to
 * rebuild the orchestrate agent input (deleted cards, removed speech lines, changed
 * copy counts are all reflected here at generation time).
 */
export interface ScenarioSource {
  scenarioId: string;
  foleyId: string | null;
  speechId: string | null;
  /** Foley `sound.id` or speech `speech.id` — links orchestrate output back to this card. */
  entryId: string;
  isSpeech: boolean;
  /** User-controlled number of audio copies to generate. */
  copyCount: number;
  // ── raw entry fields used to rebuild the orchestrate input ──
  soundName: string;
  description: string;
  category: string;
  duration: string;
  timestamps: string[];
  objectsInvolved: string[];
  position: number[];
  character: string;
  script: string;
  speechLines: string[];
  /** Resolved TTS voice value (Gemini prebuilt voice) for speech cards. */
  voiceName?: string;
}

/**
 * Scenario Config — streams a scenario from scenarist agent, then calls foley artist
 */
export interface ScenarioConfig extends AnalysisBaseConfig {
  type: 'scenario';
  userContext: string;
  peopleCount: number;
  likeliness: number;
  /** If true, pass the most recent model-analysis result as furniture context */
  useAnalysisResult: boolean;
  /** Raw streamed text (typewriter) */
  scenarioRawText: string;
  /** Structured scenario result after streaming completes */
  scenarioResult: ScenarioResult | null;
  /** UUID of the saved scenario file */
  scenarioId: string | null;
  /** Foley result after calling foley artist */
  foleyResult: FoleyResult | null;
  /** Keys of foley sounds currently selected for sound generation */
  selectedFoleyKeys: string[];
  /** Speech result after calling speech agent */
  speechResult: SpeechResult | null;
  /** UUID of the saved speech file */
  speechId: string | null;
  /** Orchestrate result after calling orchestrate agent */
  orchestrateResult: OrchestrateResult | null;
  /** UUID of the saved orchestrate file */
  orchestrateId: string | null;
}

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Generated text prompt result (after generation)
 */
export interface TextPromptResult {
  id: string;
  text: string;
  /** Optional display name override (e.g. soundName from foley, separate from prompt text) */
  displayName?: string;
  selected: boolean;
  /** @deprecated use entities[] instead */
  entity?: any;
  entities?: any[]; // All linked entities (multi-entity support)
  /** Pre-computed position from area drawing (overrides random placement) */
  position?: [number, number, number];
  metadata?: {
    dbfs?: number;
    interval_seconds?: number;
    duration_seconds?: number;
    confidence?: number;
    detection_segments?: Array<{ start_sec: number; end_sec: number }>;
    /** Explicit playback timestamps in "MM:SS" format (from foley/scenario JSON). */
    timestamps?: string[];
    /** Sound category from foley analysis (e.g. "background", "sound_event", "speech") */
    category?: string;
    /** Orchestration metadata from the full pipeline (foley+speech → orchestrate) */
    orchestrateMeta?: {
      orchestrateId: string;
      entryId: string;
      trigger: { type: string; expression: string[]; delay: number[] };
      variants: number[];
      allObjectIds: string[];
      isSpeech: boolean;
      voiceName?: string;
      speechLines?: string[];
      /** Original foley/speech timestamps (MM:SS) — fallback when trigger resolution fails. */
      timestamps?: string[];
    };
    /** Scenario pipeline reference for an "incomplete" card (foley+speech only, pre-orchestrate). */
    scenarioSource?: ScenarioSource;
  };
}

/**
 * Analysis result (after generation)
 */
export interface AnalysisResult {
  configIndex: number;
  prompts: TextPromptResult[];
  generatedAt?: Date;
}

// ============================================================================
// Section Props
// ============================================================================

/**
 * Analysis Section Props
 */
export interface AnalysisSectionProps {
  analysisConfigs: AnalysisConfig[];
  activeTab: number;
  isRunning: boolean;
  analysisResult: AnalysisResult[];
  hasGlobalModelLoaded?: boolean;

  // Callbacks
  onAddConfig: (type: CardType) => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  onSetActiveTab: (index: number) => void;
  onRun: (index: number) => void;
  onStop: () => void;
  onReset: (index: number) => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSendToSoundGeneration: () => void;
}
