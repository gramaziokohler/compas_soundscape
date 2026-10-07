/**
 * Scene workflow helpers — stateless, shared by sceneWorkflowStore, the
 * Simple-mode hooks, and the bubble components.
 */

import type { AnalysisConfig, SoundGenerationConfig, SoundEvent } from '@/types';
import type { ScenarioConfig } from '@/types/analysis';
import type { SceneRun, SceneWorkflowStep } from '@/types/sceneWorkflow';
import type { SettingsRow } from '@/components/ui/SettingsSummary';
import { CARD_TYPE_LABELS } from '@/types/card';
import { AUDIO_MODEL_NAMES, DEFAULT_LLM_MODEL, LLM_MODEL_NAMES, SIMPLE_MODE } from '@/utils/constants';

export const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

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

/**
 * Untrimmed scene title: the full prompt while the card still carries the
 * provisional title derived from it, otherwise the regular display title.
 */
export function getSceneFullTitle(config: AnalysisConfig | undefined, fallback: string): string {
  const title = getSceneTitle(config, fallback);
  if (config?.type !== 'scenario' || !config.userContext) return title;
  const prompt = config.userContext.trim().replace(/\s+/g, ' ');
  return config.display_name === deriveSceneTitle(prompt) ? prompt : title;
}

/** Scene length for chips and summaries ("30s", "2 min"). */
export function formatSceneDuration(ms: number): string {
  const sec = Math.round(ms / MS_PER_SECOND);
  return sec < SECONDS_PER_MINUTE ? `${sec}s` : `${Math.round(sec / SECONDS_PER_MINUTE)} min`;
}

/**
 * Read-only "Scene settings" rows for a scenario scene. Card fields always
 * apply; composer-only options (audio model, image, re-analysis) are
 * shown when the scene's run is known. `appSpeechLanguage` is the app-wide TTS
 * language used when the composer left the language empty.
 */
export function getSceneSettingsRows(
  sc: ScenarioConfig,
  run: SceneRun | undefined,
  appSpeechLanguage: string,
): SettingsRow[] {
  const rows: SettingsRow[] = [];
  const prompt = sc.userContext?.trim();
  rows.push(prompt
    ? { label: 'Prompt', value: prompt, expandable: true }
    : { label: 'Prompt', value: 'None — from the model analysis' });
  if (sc.timelineDurationMs) rows.push({ label: 'Duration', value: formatSceneDuration(sc.timelineDurationMs) });
  const speech = sc.includeSpeech !== false;
  rows.push({ label: 'Speech', value: speech ? 'Yes' : 'No' });
  if (speech) {
    const language = run?.options.speechLanguage || appSpeechLanguage;
    if (language) rows.push({ label: 'Speech language', value: language });
  }
  rows.push({ label: 'People', value: String(sc.peopleCount) });
  rows.push({ label: 'Plausibility', value: `${sc.likeliness}/${SIMPLE_MODE.SCENARIO_LIKELINESS_MAX}` });
  const llm = sc.llmModel ?? DEFAULT_LLM_MODEL;
  rows.push({ label: 'LLM', value: LLM_MODEL_NAMES[llm] ?? llm });
  if (run) {
    const { audioModel, image, reanalyze } = run.options;
    rows.push({ label: 'Text-to-audio', value: AUDIO_MODEL_NAMES[audioModel] ?? audioModel });
    if (image) rows.push({ label: 'Reference image', value: image.name, expandable: true });
    if (reanalyze) rows.push({ label: 'Model re-analysed', value: 'Yes' });
  } else if (sc.referenceImages?.length) {
    rows.push({ label: 'Reference image', value: 'Yes' });
  }
  return rows;
}

/** Expert-sidebar wizard step that shows a given pipeline step's card. */
export function workflowStepToWizardStep(step: SceneWorkflowStep | null): 0 | 1 | 2 {
  if (step === 'analyze') return 0;
  if (step === 'generate') return 2;
  return 1;
}

export const SCENE_WORKFLOW_STEPS: SceneWorkflowStep[] = ['analyze', 'scenario', 'foley', 'generate'];
