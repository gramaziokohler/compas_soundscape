/**
 * Analysis Types
 * 
 * Types for the Analysis section that manages three types of context analysis:
 * - 3D Model context (geometry_service.py)
 * - Audio context (sed_service.py)
 * - Text context (llm_service.py)
 */

import type { SEDAudioInfo, DetectedSound, SEDAnalysisOptions } from './sed';

/**
 * Analysis tab types
 */
export type AnalysisType = '3d-model' | 'audio' | 'text';

/**
 * Base analysis configuration (before generation)
 */
export interface BaseAnalysisConfig {
  type: AnalysisType;
  display_name?: string;
  numSounds: number; // Number of sound prompts to generate
}

/**
 * 3D Model Analysis Config
 */
export interface ModelAnalysisConfig extends BaseAnalysisConfig {
  type: '3d-model';
  modelFile: File | null;
  modelEntities: any[];
  selectedDiverseEntities: any[];
  useModelAsContext: boolean;
  geometryData?: any; // Loaded geometry data for ThreeScene
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
export interface AudioAnalysisConfig extends BaseAnalysisConfig {
  type: 'audio';
  audioFile: File | null;
  audioInfo: SEDAudioInfo | null;
  audioBuffer: AudioBuffer | null;
  analysisOptions: SEDAnalysisOptions;
}

/**
 * Text Analysis Config
 */
export interface TextAnalysisConfig extends BaseAnalysisConfig {
  type: 'text';
  textInput: string;
  useModelAsContext: boolean;
}

/**
 * Union type for all analysis configs
 */
export type AnalysisConfig = ModelAnalysisConfig | AudioAnalysisConfig | TextAnalysisConfig;

/**
 * Generated text prompt result
 */
export interface TextPromptResult {
  id: string;
  text: string;
  selected: boolean;
  entity?: any; // Linked entity for 3D model analysis
  metadata?: {
    spl_db?: number;
    interval_seconds?: number;
    duration_seconds?: number;
    confidence?: number;
  };
}

/**
 * Analysis result (after generation)
 */
export interface AnalysisResult {
  configIndex: number;
  prompts: TextPromptResult[];
  generatedAt: Date;
}

/**
 * Analysis tab state
 */
export interface AnalysisTabState {
  config: AnalysisConfig;
  isAnalyzing: boolean;
  result: AnalysisResult | null;
  error: string | null;
}

/**
 * Analysis Section Props
 */
export interface AnalysisSectionProps {
  analysisConfigs: AnalysisConfig[];
  activeAnalysisTab: number;
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResults: AnalysisResult[];
  hasGlobalModelLoaded?: boolean; // Global model loaded from right sidebar
  onAddConfig: (type: AnalysisType) => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  onSetActiveTab: (index: number) => void;
  onAnalyze: (index: number) => void;
  onStopAnalysis: () => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSendToSoundGeneration: () => void;
  onReset: (index: number) => void;
}
