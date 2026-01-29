/**
 * Analysis Types
 * 
 * Types for the Analysis section that manages three types of context analysis:
 * - 3D Model context (geometry_service.py)
 * - Audio context (sed_service.py)
 * - Text context (llm_service.py)
 */

import type { SEDAudioInfo, DetectedSound, SEDAnalysisOptions } from './sed';
import type { TabBaseConfig , CardType, TabResult, TabProps } from './card';


/**
 * 3D Model Analysis Config
 */
export interface ModelAnalysisConfig extends TabBaseConfig {
  CardType: '3d-model';
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
export interface AudioAnalysisConfig extends TabBaseConfig {
  CardType: 'audio';
  audioFile: File | null;
  audioInfo: SEDAudioInfo | null;
  audioBuffer: AudioBuffer | null;
  analysisOptions: SEDAnalysisOptions;
}

/**
 * Text Analysis Config
 */
export interface TextAnalysisConfig extends TabBaseConfig {
  CardType: 'text';
  textInput: string;
  useModelAsContext: boolean;
}

/**
 * Union type for all analysis configs
 */
export type AnalysisConfig = ModelAnalysisConfig | AudioAnalysisConfig | TextAnalysisConfig;

/**
 * Generated text prompt result (after generation)
 */
export interface TextPromptResult extends TabResult{
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
export interface AnalysisResult extends TabResult{
  configIndex: number;
  prompts: TextPromptResult[];
}

/**
 * Analysis Section Props
 */
export interface AnalysisSectionProps extends TabProps {
  analysisConfigs: AnalysisConfig[];
  analysisResult: AnalysisResult[];
  hasGlobalModelLoaded?: boolean; // Global model loaded from right sidebar
  onStopAnalysis: () => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSendToSoundGeneration: () => void;
}
