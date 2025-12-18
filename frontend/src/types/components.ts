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
  SoundGenerationMode,
  ActiveTab,
  LoadTab,
  SoundState,
  SEDAudioInfo,
  SEDAnalysisOptions,
  DetectedSound,
  LibrarySearchResult,
  ReceiverData,
  EntityData,
  AnalysisConfig,
  AnalysisResult,
  AnalysisType,
} from "./index";
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
  modelFile: File | null;
  audioFile: File | null;
  geometryData: CompasGeometry | null;
  soundscapeData: SoundEvent[] | null;
  selectedVariants: { [key: number]: number };
  activeAiTab: ActiveTab;
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
  audioModel: string;
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
  setActiveAiTab: (tab: ActiveTab) => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setAiPrompt: (prompt: string) => void;
  setNumSounds: (num: number) => void;
  onGenerateText: () => void;
  onStopGeneration: () => void;
  onLoadSoundsToGeneration: () => void;
  setActiveSoundConfigTab: (tab: number) => void;
  onAddSoundConfig: (mode?: SoundGenerationMode) => void;
  onBatchAddSoundConfigs: (count: number) => number;
  onRemoveSoundConfig: (index: number) => void;
  onUpdateSoundConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onSoundModeChange: (index: number, mode: SoundGenerationMode) => void;
  onGenerateSounds: () => void;
  onStopSoundGeneration: () => void;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onAudioModelChange: (model: string) => void;
  onReprocessSounds?: (applyDenoising: boolean) => Promise<void>;
  setUseModelAsContext: (value: boolean) => void;
  onUploadAudio: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio: (index: number) => void;
  onLibrarySearch: (index: number) => Promise<void>;
  onLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  // Entity linking props
  onStartLinkingEntity?: (configIndex: number) => void;
  onCancelLinkingEntity?: () => void;
  isLinkingEntity?: boolean;
  linkingConfigIndex?: number | null;
  // Audio controls props
  individualSoundStates?: { [soundId: string]: SoundState };
  onToggleSound?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onMute?: (soundId: string) => void;
  onSolo?: (soundId: string) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
  mutedSounds?: Set<string>;
  soloedSound?: string | null;
  onResetSound?: (soundId: string, promptIndex: number) => void;
  onSelectSoundCard?: (promptIndex: number) => void;
  selectedCardIndex?: number | null;
  soundVolumes?: { [soundId: string]: number };
  soundIntervals?: { [soundId: string]: number };
  // Soundcard preview playback props
  previewingSoundId?: string | null;
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
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
  // IR Library props
  onSelectIRFromLibrary: (irMetadata: any) => Promise<void>;
  onClearIR: () => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;
  // Receiver props
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
  onGoToReceiver: (id: string) => void;
  // ShoeBox Acoustics props
  resonanceAudioConfig: ResonanceAudioConfig;
  onToggleResonanceAudio: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: ResonanceRoomMaterial) => void;
  hasGeometry: boolean;
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;
  // Audio Orchestrator props (NEW)
  audioRenderingMode?: AudioRenderingMode;
  onAudioRenderingModeChange?: (mode: AudioRenderingMode) => void;
  // Material assignment props (NEW)
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;
  // Choras Simulation props (NEW)
  onIRImported?: () => void;
  irRefreshTrigger?: number;
  // Acoustics simulation state (NEW - passed from page.tsx to avoid duplicate hook calls)
  simulationConfigs?: SimulationConfig[];
  activeSimulationIndex?: number | null;
  expandedTabIndex?: number | null;
  onAddSimulationConfig?: (mode: AcousticSimulationMode) => void;
  onRemoveSimulationConfig?: (index: number) => void;
  onUpdateSimulationConfig?: (index: number, updates: Partial<SimulationConfig>) => void;
  onSetActiveSimulation?: (index: number | null) => void;
  onUpdateSimulationName?: (index: number, name: string) => void;
  onToggleExpandSimulation?: (index: number) => void;
  // Analysis props (NEW)
  analysisConfigs: AnalysisConfig[];
  activeAnalysisTab: number;
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResults: AnalysisResult[];
  onAddAnalysisConfig: (type: AnalysisType) => void;
  onRemoveAnalysisConfig: (index: number) => void;
  onUpdateAnalysisConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  onSetActiveAnalysisTab: (index: number) => void;
  onAnalyze: (index: number) => void;
  onStopAnalysis: () => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSendToSoundGeneration: () => void;
  onResetAnalysis: (index: number) => void;
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
  onAddConfig: (mode?: SoundGenerationMode) => void;
  onBatchAddConfigs: (count: number) => number;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onSetActiveTab: (index: number) => void;
  onGenerate: () => void;
  onStopGeneration: () => void;
  generatedSounds: SoundEvent[];
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  audioModel: string;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onAudioModelChange: (model: string) => void;
  onReprocessSounds?: (applyDenoising: boolean) => Promise<void>;
  onUploadAudio: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio: (index: number) => void;
  onLibrarySearch: (index: number) => Promise<void>;
  onLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  // Entity linking props
  modelEntities: any[];
  onStartLinkingEntity?: (configIndex: number) => void;
  onCancelLinkingEntity?: () => void;
  isLinkingEntity?: boolean;
  linkingConfigIndex?: number | null;
  // Audio controls props
  individualSoundStates?: { [soundId: string]: SoundState };
  onToggleSound?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onMute?: (soundId: string) => void;
  onSolo?: (soundId: string) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
  mutedSounds?: Set<string>;
  soloedSound?: string | null;
  onResetSound?: (soundId: string, promptIndex: number) => void;
  onSelectSoundCard?: (promptIndex: number) => void;
  selectedCardIndex?: number | null;
  soundVolumes?: { [soundId: string]: number };
  soundIntervals?: { [soundId: string]: number };
  selectedVariants?: { [promptIdx: number]: number };
  // Soundcard preview playback props
  previewingSoundId?: string | null;
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
  // Receiver props
  receivers?: ReceiverData[];
  isPlacingReceiver?: boolean;
  onStartPlacingReceiver?: () => void;
  onDeleteReceiver?: (id: string) => void;
  onUpdateReceiverName?: (id: string, name: string) => void;
  onGoToReceiver?: (id: string) => void;
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
