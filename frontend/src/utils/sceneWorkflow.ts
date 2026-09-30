/**
 * Scene workflow helpers — stateless, shared by sceneWorkflowStore, the
 * Simple-mode hooks, and the bubble components.
 */

import type { AnalysisConfig, SoundGenerationConfig, SoundEvent } from '@/types';
import type { SceneWorkflowStep } from '@/types/sceneWorkflow';
import { CARD_TYPE_LABELS } from '@/types/card';
import { SIMPLE_MODE } from '@/utils/constants';

/** Speech-line TTS sounds encode their card index as `prompt_index = cardIndex * 10000 + line`. */
const SPEECH_LINE_INDEX_FACTOR = 10000;

/**
 * Whether the sound card at `index` has at least one generated event.
 * Identity is matched by `config_id`; `prompt_index` is the legacy fallback
 * (mirrors `isSoundGenerated` in SoundGenerationSection).
 */
export function isSoundConfigGenerated(
  soundConfigs: SoundGenerationConfig[],
  generatedSounds: SoundEvent[],
  index: number,
): boolean {
  const configId = soundConfigs[index]?.config_id;
  return generatedSounds.some((s) => {
    if (configId && s.config_id) return s.config_id === configId;
    const pi = s.prompt_index;
    if (pi === index) return true;
    return pi != null && pi >= SPEECH_LINE_INDEX_FACTOR && Math.floor(pi / SPEECH_LINE_INDEX_FACTOR) === index;
  });
}

/** Indices of the sound cards parented to a usage (scene) card. */
export function getSceneSoundIndices(soundConfigs: SoundGenerationConfig[], usageIndex: number): number[] {
  const out: number[] = [];
  soundConfigs.forEach((c, i) => {
    if (c.parentUsageOriginalIndex === usageIndex) out.push(i);
  });
  return out;
}

/** True when a model-analysis context card holds a finished analysis the scenario agents can reuse. */
export function hasModelAnalysisResult(config: AnalysisConfig | undefined): boolean {
  return config?.type === 'model-analysis' && !!config.analysisResult?.analysisId;
}

/** Short provisional scene title from the user's prompt (the scenarist later renames the card). */
export function deriveSceneTitle(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  if (clean.length <= SIMPLE_MODE.TITLE_MAX_CHARS) return clean;
  return `${clean.slice(0, SIMPLE_MODE.TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/** Display title of a scene (usage) card. */
export function getSceneTitle(config: AnalysisConfig | undefined, fallback: string): string {
  if (!config) return fallback;
  if (config.display_name) return config.display_name;
  if (config.type === 'scenario') {
    const title = config.scenarioResult?.scenarios?.[0]?.title;
    if (title) return title;
  }
  return CARD_TYPE_LABELS[config.type] || fallback;
}

/** Expert-sidebar wizard step that shows a given pipeline step's card. */
export function workflowStepToWizardStep(step: SceneWorkflowStep | null): 0 | 1 | 2 {
  if (step === 'analyze') return 0;
  if (step === 'generate') return 2;
  return 1;
}

export const SCENE_WORKFLOW_STEPS: SceneWorkflowStep[] = ['analyze', 'scenario', 'foley', 'generate'];
