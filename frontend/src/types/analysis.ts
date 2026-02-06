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
 * Union type for all analysis configs
 */
export type AnalysisConfig = ModelAnalysisConfig | AudioAnalysisConfig | TextAnalysisConfig;

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Generated text prompt result (after generation)
 */
export interface TextPromptResult {
  id: string;
  text: string;
  selected: boolean;
  entity?: any;
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
  error: string | null;
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
