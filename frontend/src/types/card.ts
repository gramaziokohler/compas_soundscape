/**
 * Parent Types for Card UI Components
 * 
 */


/**
 * Card types
 */
export type CardType = '3d-model' | 'audio' | 'text';

/**
 * Base configuration (before generation)
 */
export interface TabBaseConfig {
  type: CardType;
  display_name?: string;
  numSounds?: number; // Number of sound prompts to generate
}

/**
 * Tab state
 */
export interface TabState {
  config: TabBaseConfig;
  isRunning: boolean;
  result: TabResult | null;
  error: string | null;
}

/**
 * Result (after generation)
 */
export interface TabResult {
  config: TabBaseConfig[];
//   result: TabBaseConfig[];
  generatedAt: Date;
}

/**
 * Sidebar Props
 */
export interface TabProps {
  baseConfigs: TabBaseConfig[];
  activeTab: number;
  isRunning: boolean;
  error: string | null;
//   result: TabResult[];
  onAddConfig: (type: CardType) => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<TabBaseConfig>) => void;
  onSetActiveTab: (index: number) => void;
  onRun: (index: number) => void;
  onStop: () => void;
  onReset: (index: number) => void;
  onCopy: (index: number) => void;
}
