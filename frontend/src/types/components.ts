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
} from "./index";
import type { AuralizationConfig } from "./auralization";
import type { ResonanceAudioConfig, ResonanceRoomDimensions, ResonanceRoomMaterial } from "./audio";
import type { ModalAnalysisResult, ModeVisualizationState } from "./modal";

/**
 * Sidebar Component Props
 */
export interface SidebarProps {
  file: File | null;
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
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onUpload: () => void;
  onLoadSampleIfc: () => void;
  onClearModel: () => void;
  setActiveAiTab: (tab: ActiveTab) => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setAiPrompt: (prompt: string) => void;
  setNumSounds: (num: number) => void;
  onGenerateText: () => void;
  onStopGeneration: () => void;
  onLoadSoundsToGeneration: () => void;
  setActiveSoundConfigTab: (tab: number) => void;
  onAddSoundConfig: () => void;
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
  // IR Library props
  onSelectIRFromLibrary: (irMetadata: any) => Promise<void>;
  onClearIR: () => void;
  onToggleNormalize: (enabled: boolean) => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;
  // Receiver props
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
  // Resonance Audio props
  resonanceAudioConfig: ResonanceAudioConfig;
  onToggleResonanceAudio: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: ResonanceRoomMaterial) => void;
  hasGeometry: boolean;
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;
  // Audio Orchestrator props (NEW)
  preferredNoIRMode?: 'threejs' | 'resonance';
  onUpdateNoIRMode?: (mode: 'threejs' | 'resonance') => void;
  outputDecoder?: 'binaural' | 'stereo';
  onUpdateOutputDecoder?: (decoder: 'binaural' | 'stereo') => void;
}

/**
 * Model Load Section Component Props
 */
export interface ModelLoadSectionProps {
  modelEntities: any[];
  activeLoadTab: LoadTab;
  file: File | null;
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
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onUpload: () => void;
  onLoadSampleIfc: () => void;
  onClearModel: () => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setUseModelAsContext: (value: boolean) => void;
  // SED-specific handlers
  onAnalyzeSoundEvents?: () => void;
  onToggleSEDOption?: (option: keyof SEDAnalysisOptions, value: boolean) => void;
  onLoadSoundsFromSED?: () => void;
}

/**
 * Sound Generation Section Component Props
 */
export interface SoundGenerationSectionProps {
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  isSoundGenerating: boolean;
  soundGenError: string | null;
  onAddConfig: () => void;
  onBatchAddConfigs: (count: number) => number;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onModeChange: (index: number, mode: SoundGenerationMode) => void;
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
