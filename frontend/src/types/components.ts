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
  DetectedSound,
  LibrarySearchResult,
  ReceiverData,
} from "./index";
import type { AuralizationConfig } from "./auralization";

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
  onLoadSoundsToGeneration: () => void;
  setActiveSoundConfigTab: (tab: number) => void;
  onAddSoundConfig: () => void;
  onRemoveSoundConfig: (index: number) => void;
  onUpdateSoundConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onSoundModeChange: (index: number, mode: SoundGenerationMode) => void;
  onGenerateSounds: () => void;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onReprocessSounds?: (applyDenoising: boolean) => Promise<void>;
  setUseModelAsContext: (value: boolean) => void;
  onUploadAudio: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio: (index: number) => void;
  onLibrarySearch: (index: number) => Promise<void>;
  onLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  // SED props
  isSEDAnalyzing?: boolean;
  sedAudioInfo?: SEDAudioInfo | null;
  sedAudioBuffer?: AudioBuffer | null;
  sedDetectedSounds?: DetectedSound[];
  sedError?: string | null;
  sedAnalysisOptions?: {
    analyzeAmplitudes: boolean;
    analyzeDurations: boolean;
  };
  onAnalyzeSoundEvents?: () => void;
  onToggleSEDOption?: (option: "analyzeAmplitudes" | "analyzeDurations", value: boolean) => void;
  onLoadSoundsFromSED?: () => void;
  // Auralization props
  auralizationConfig: AuralizationConfig;
  auralizationLoading: boolean;
  auralizationError: string | null;
  onToggleAuralization: (enabled: boolean) => void;
  onToggleNormalize: (normalize: boolean) => void;
  onLoadImpulseResponse: (file: File) => Promise<void>;
  onClearImpulseResponse: () => void;
  // Receiver props
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string) => void;
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
  sedAnalysisOptions?: {
    analyzeAmplitudes: boolean;
    analyzeDurations: boolean;
  };
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
  onToggleSEDOption?: (option: "analyzeAmplitudes" | "analyzeDurations", value: boolean) => void;
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
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onModeChange: (index: number, mode: SoundGenerationMode) => void;
  onSetActiveTab: (index: number) => void;
  onGenerate: () => void;
  generatedSounds: SoundEvent[];
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onReprocessSounds?: (applyDenoising: boolean) => Promise<void>;
  onUploadAudio: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio: (index: number) => void;
  onLibrarySearch: (index: number) => Promise<void>;
  onLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
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
  onLoadSoundsToGeneration: () => void;
}
