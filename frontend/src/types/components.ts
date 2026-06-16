/**
 * Component Prop Types
 *
 * Centralized type definitions for component props.
 * Extracted from component files to reduce clutter and improve reusability.
 */

import type {
  CompasGeometry,
  SoundEvent,
  SoundGenerationConfig,
  LoadTab,
  SoundState,
  SEDAudioInfo,
  SEDAnalysisOptions,
  DetectedSound,
  LibrarySearchResult,
  CatalogSoundSelection,
  ReceiverData,
  EntityData,
  AnalysisConfig,
  AnalysisResult,
  CardType,
} from "./index";
import type { AudioAnalysisConfig } from "./analysis";
import type { GridListenerData } from "./receiver";
import type { AuralizationConfig, ResonanceAudioConfig, ResonanceRoomDimensions, ResonanceRoomMaterial } from "./audio";
import type { ModalAnalysisResult, ModeVisualizationState } from "./modal";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";
import type { SelectedGeometry, AcousticMaterial } from "./materials";
import type { SimulationConfig, AcousticSimulationMode } from "./acoustics";

/**
 * Sidebar Component Props
 */
export interface SidebarProps {
  // Separate model and audio file states
  audioFile: File | null;
  activeLoadTab: LoadTab;
  modelEntities: any[];
  aiPrompt: string;
  numSounds: number;
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  generatedSounds: any[];
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  trimSilence: boolean;
  applyNoiseReduction: boolean;
  normalizeImpulseResponses: boolean;
  audioModel: string;
  llmModel: string;
  showAxesHelper: boolean;
  isUploading: boolean;
  isAnalyzingModel: boolean;
  isGenerating: boolean;
  isSoundGenerating: boolean;
  isDragging: boolean;
  uploadError: string | null;
  aiError: string | null;
  soundGenError: string | null;
  aiResponse: string | null;
  analysisProgress: string;
  llmProgress: string;
  showConfirmLoadSounds: boolean;
  pendingSoundConfigs: any[];
  useModelAsContext: boolean;
  // File handlers (single upload area)
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onUploadModel: () => void;
  onLoadSampleIfc: () => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setAiPrompt: (prompt: string) => void;
  setNumSounds: (num: number) => void;
  onGenerateText: () => void;
  onStopGeneration: () => void;
  onLoadSoundsToGeneration: () => void;
  setActiveSoundConfigTab: (tab: number) => void;
  onAddSoundConfig: (type?: CardType) => void;
  onBatchAddSoundConfigs: (count: number) => number;
  onRemoveSoundConfig: (index: number) => void;
  onUpdateSoundConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onSoundTypeChange: (index: number, type: CardType) => Promise<void>;
  onGenerateSounds: () => void;
  onGenerateSingleSound: (index: number) => Promise<void>;
  onGenerateFilteredSounds: (indices: number[]) => Promise<void>;
  onStopSoundGeneration: () => void;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onTrimSilenceChange: (value: boolean) => void;
  onApplyNoiseReductionChange: (apply: boolean) => void;
  onNormalizeImpulseResponsesChange: (value: boolean) => void;
  onAudioModelChange: (model: string) => void;
  onLlmModelChange: (model: string) => void;
  onShowAxesHelperChange: (show: boolean) => void;
  showLabelSprites: boolean;
  onShowLabelSpritesChange: (v: boolean) => void;
  showHoveringHighlight: boolean;
  onShowHoveringHighlightChange: (v: boolean) => void;
  showSoundSpheres: boolean;
  onShowSoundSpheresChange: (v: boolean) => void;
  showSceneListeners: boolean;
  onShowSceneListenersChange: (v: boolean) => void;
  showGroundGrid: boolean;
  onShowGroundGridChange: (v: boolean) => void;
  groundGridSpacing: number;
  onGroundGridSpacingChange: (v: number) => void;
  groundGridColor: string;
  onGroundGridColorChange: (v: string) => void;
  onResetAdvancedSettings: () => void;
  listenerOrientation: { x: number; y: number; z: number };
  onListenerOrientationChange: (orientation: { x: number; y: number; z: number }) => void;
  onReprocessSounds?: (applyDenoising: boolean, trimSilence?: boolean) => Promise<void>;
  setUseModelAsContext: (value: boolean) => void;
  onUploadAudio: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio: (index: number) => void;
  onLibrarySearch: (index: number) => Promise<void>;
  onLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  onCatalogSoundSelect?: (index: number, sound: CatalogSoundSelection) => void;
  // Entity linking props
  onStartLinkingEntity?: (configIndex: number) => void;
  onCancelLinkingEntity?: () => void;
  onFinishLinkingEntity?: () => void;
  onSelectLinkedEntity?: (configIndex: number, entityArrayIdx: number) => void;
  onClearLinkedEntities?: (configIndex: number) => void;
  isLinkingEntity?: boolean;
  linkingConfigIndex?: number | null;
  // Speckle viewer mode - enables entity linking for Speckle objects
  useSpeckleViewer?: boolean;
  onResetSound?: (soundId: string, promptIndex: number) => void;
  onDuplicateConfig?: (index: number) => void;
  onSelectSoundCard?: (promptIndex: number) => void;
  selectedCardIndex?: number | null;
  // SED props
  isSEDAnalyzing?: boolean;
  sedAudioInfo?: SEDAudioInfo | null;
  sedAudioBuffer?: AudioBuffer | null;
  sedDetectedSounds?: DetectedSound[];
  sedError?: string | null;
  sedAnalysisOptions?: SEDAnalysisOptions;
  onAnalyzeSoundEvents?: () => void;
  onToggleSEDOption?: (option: keyof SEDAnalysisOptions, value: boolean) => void;
  onLoadSoundsFromSED?: () => void;
  // Entity analysis props (LLM Step 1)
  selectedDiverseEntities?: any[];
  isAnalyzingEntities?: boolean;
  onAnalyzeModel?: () => void;
  // Analysis props (NEW)
  analysisConfigs: AnalysisConfig[];
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResult: AnalysisResult[];
  hasGlobalModelLoaded?: boolean; // Global model loaded from right sidebar
  onAddAnalysisConfig: (type: CardType) => void;
  onRemoveAnalysisConfig: (index: number) => void;
  onUpdateAnalysisConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  onAnalyze: (index: number) => void;
  onStop: () => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSendToSoundGeneration: (parentUsageIndex?: number) => void;
  onResetAnalysis: (index: number) => void;
  /** Async callback to extract SED audio segments and inject them as sound cards. */
  onAudioExtract: (config: AudioAnalysisConfig, originalIndex: number) => Promise<void>;
  // Sidebar expanded state callback
  onExpandedChange?: (isExpanded: boolean) => void;
  // Sidebar content width change callback (fires during resize drag)
  onWidthChange?: (width: number) => void;
  // Step advance trigger: increment to programmatically advance to step 2 (Sounds)
  stepAdvanceTrigger?: number;
}

/**
 * Model Load Section Component Props
 */
export interface ModelLoadSectionProps {
  modelEntities: any[];
  activeLoadTab: LoadTab;
  // Separate model and audio file states
  modelFile: File | null;
  audioFile: File | null;
  isDragging: boolean;
  isUploading: boolean;
  isAnalyzingModel: boolean;
  uploadError: string | null;
  analysisProgress: string;
  useModelAsContext: boolean;
  // SED-specific props
  isSEDAnalyzing?: boolean;
  sedAudioInfo?: SEDAudioInfo | null;
  sedAudioBuffer?: AudioBuffer | null;
  sedDetectedSounds?: DetectedSound[];
  sedError?: string | null;
  sedAnalysisOptions?: SEDAnalysisOptions;
  // File handlers (single upload area)
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onUploadModel: () => void;
  onLoadSampleIfc: () => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setUseModelAsContext: (value: boolean) => void;
  // SED-specific handlers
  onAnalyzeSoundEvents?: () => void;
  onToggleSEDOption?: (option: keyof SEDAnalysisOptions, value: boolean) => void;
  onLoadSoundsFromSED?: () => void;
  // Entity analysis props (LLM Step 1)
  selectedDiverseEntities?: any[];
  isAnalyzingEntities?: boolean;
  llmProgress?: string;
  numSounds?: number;
  onAnalyzeModel?: () => void;
  onStopGeneration?: () => void;
}

/**
 * Sound Generation Section Component Props
 */
export interface SoundGenerationSectionProps {
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  isSoundGenerating: boolean;
  soundGenError: string | null;
  onAddConfig: (type?: CardType) => void;
  onBatchAddConfigs: (count: number) => number;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onTypeChange?: (index: number, type: CardType) => Promise<void>;
  onSetActiveTab: (index: number) => void;
  onGenerate: () => void;
  onGenerateSingle: (index: number) => Promise<void>;
  onGenerateFiltered: (indices: number[]) => Promise<void>;
  onStopGeneration: () => void;
  generatedSounds: SoundEvent[];
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  trimSilence: boolean;
  applyNoiseReduction: boolean;
  audioModel: string;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onTrimSilenceChange: (value: boolean) => void;
  onApplyNoiseReductionChange: (apply: boolean) => void;
  onAudioModelChange: (model: string) => void;
  onReprocessSounds?: (applyDenoising: boolean, trimSilence?: boolean) => Promise<void>;
  onUploadAudio: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio: (index: number) => void;
  onLibrarySearch: (index: number) => Promise<void>;
  onLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  onCatalogSoundSelect?: (index: number, sound: CatalogSoundSelection) => void;
  // Entity linking props
  modelEntities: any[];
  onStartLinkingEntity?: (configIndex: number) => void;
  onCancelLinkingEntity?: () => void;
  onFinishLinkingEntity?: () => void;
  onSelectLinkedEntity?: (configIndex: number, entityArrayIdx: number) => void;
  onClearLinkedEntities?: (configIndex: number) => void;
  isLinkingEntity?: boolean;
  linkingConfigIndex?: number | null;
  // Speckle viewer mode - enables entity Entity linking for Speckle objects
  useSpeckleViewer?: boolean;
  onResetSound?: (soundId: string, promptIndex: number) => void;
  onDuplicateConfig?: (index: number) => void;
  onSelectSoundCard?: (promptIndex: number) => void;
  selectedCardIndex?: number | null;
  // Receiver props
  receivers?: ReceiverData[];
  onAddReceiver?: () => void;
  onDeleteReceiver?: (id: string) => void;
  onUpdateReceiverName?: (id: string, name: string) => void;
  onGoToReceiver?: (id: string) => void;
  /** When set, only show sound configs whose parentUsageOriginalIndex matches this value */
  visibleParentUsageIndex?: number | null;
}

/**
 * Text Generation Section Component Props
 */
export interface TextGenerationSectionProps {
  modelEntities: any[];
  aiPrompt: string;
  numSounds: number;
  isGenerating: boolean;
  isAnalyzingModel: boolean;
  isAnalyzingEntities?: boolean;  // NEW: for entity analysis state
  llmProgress: string;
  aiError: string | null;
  aiResponse: string | null;
  showConfirmLoadSounds: boolean;
  analysisProgress: string;
  setAiPrompt: (prompt: string) => void;
  setNumSounds: (num: number) => void;
  onGenerateText: () => void;
  onStopGeneration: () => void;
  onLoadSoundsToGeneration: () => void;
}
