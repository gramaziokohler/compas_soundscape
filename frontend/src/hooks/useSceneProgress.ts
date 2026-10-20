import { useMemo } from 'react';
import { useAnalysisStore, useSoundscapeStore, useSceneWorkflowStore } from '@/store';
import type { SceneProgress, SceneWorkflowStep, SoundScene } from '@/types/sceneWorkflow';
import { SIMPLE_MODE } from '@/utils/constants';
import {
  SCENE_WORKFLOW_STEPS,
  deriveObservedSceneStep,
  getSceneSoundIndices,
  hasModelAnalysisResult,
  isSoundConfigGenerated,
} from '@/utils/sceneWorkflow';
import { useCardAnalysisStatus } from './useCardAnalysisStatus';

const PERCENT = 100;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Sum of the weights of every step before `step`. */
function weightBefore(step: SceneWorkflowStep): number {
  let total = 0;
  for (const s of SCENE_WORKFLOW_STEPS) {
    if (s === step) break;
    total += SIMPLE_MODE.STEP_WEIGHTS[s];
  }
  return total;
}

const IDLE_DETAIL = { stepPercent: 0, thinking: '', orchestrating: false } as const;

/**
 * Display state of a scene bubble: status, current step, global advancement
 * (0..1) across the four pipeline steps, and a one-line status text.
 *
 * A scene with no run in this tab (another member's browser in a shared
 * workspace, or a pipeline started before a refresh) is shown running while its
 * reattached card jobs are busy (see `deriveObservedSceneStep`).
 *
 * Scenes run concurrently, so a running scene reads only its own live state:
 * its card's analysis status (the context card during Analyze), its sound
 * cards' generation progress, and its scenario's orchestration. Idle scenes
 * derive their state from the cards (scenario / foley results, generated sounds).
 *
 * Usage:
 * ```tsx
 * const { status, fraction, statusText } = useSceneProgress(scene);
 * ```
 */
export function useSceneProgress(scene: SoundScene): SceneProgress {
  const run = useSceneWorkflowStore((s) => s.runs[scene.usageIndex]);
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const activeGenerationCardIndices = useSoundscapeStore((s) => s.activeGenerationCardIndices);
  const scenarioAnalyzing = useAnalysisStore((s) => s.analyzingConfigIndices.has(scene.usageIndex));
  const contextAnalyzing = useAnalysisStore(
    (s) => scene.contextIndex !== null && s.analyzingConfigIndices.has(scene.contextIndex),
  );
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const soundGenCardProgress = useSoundscapeStore((s) => s.soundGenCardProgress);
  const soundGenCardStatus = useSoundscapeStore((s) => s.soundGenCardStatus);
  const scenario = analysisConfigs[scene.usageIndex];
  const scenarioId = scenario?.type === 'scenario' ? scenario.scenarioId : null;
  const orchestrating = useSoundscapeStore(
    (s) => !!scenarioId && s.orchestratingScenarioIds.includes(scenarioId),
  );
  const orchestrateThinking = useSoundscapeStore((s) => s.orchestrateThinking);

  const observedStep = run
    ? null
    : deriveObservedSceneStep({
        scenario,
        soundIndices: getSceneSoundIndices(soundConfigs, scene.usageIndex),
        activeGenerationCardIndices,
        orchestrating,
        scenarioAnalyzing,
        contextAnalyzing,
      });
  const step = run?.status === 'running' ? run.step : observedStep;
  const running = step !== null;
  // The Analyze step reports on the context card; the other LLM steps on the scene card.
  const cardAnalysis = useCardAnalysisStatus(
    running ? (step === 'analyze' ? (run?.contextIndex ?? scene.contextIndex) : scene.usageIndex) : null,
  );

  return useMemo<SceneProgress>(() => {
    if (running && step) {
      let stepPercent: number;
      let detail: string;
      let thinking: string;
      if (step === 'generate') {
        // Average of the scene's sound cards (generated cards count as complete).
        const indices = getSceneSoundIndices(soundConfigs, scene.usageIndex);
        const percents = indices.map((i) =>
          isSoundConfigGenerated(soundConfigs, generatedSounds, i) ? PERCENT : soundGenCardProgress[i] ?? 0,
        );
        stepPercent = percents.length > 0 ? percents.reduce((a, b) => a + b, 0) / percents.length : 0;
        const active = indices.find((i) => soundGenCardStatus[i] && soundGenCardStatus[i] !== 'Pending…');
        detail = orchestrating ? '' : (active !== undefined ? soundGenCardStatus[active] : '');
        thinking = orchestrating ? orchestrateThinking : '';
      } else {
        stepPercent = cardAnalysis.progress;
        detail = cardAnalysis.status;
        thinking = cardAnalysis.thinking;
      }
      const fraction = clamp01(
        weightBefore(step) + SIMPLE_MODE.STEP_WEIGHTS[step] * clamp01(stepPercent / PERCENT),
      );
      const showsOrchestrate = step === 'generate' && orchestrating;
      const label = showsOrchestrate ? SIMPLE_MODE.ORCHESTRATE_LABEL : SIMPLE_MODE.STEP_LABELS[step];
      return {
        status: 'running',
        step,
        fraction,
        statusText: detail ? `${label} · ${detail}` : `${label}…`,
        stepPercent: Math.max(0, Math.min(PERCENT, stepPercent)),
        thinking,
        orchestrating: showsOrchestrate,
      };
    }

    if (run?.status === 'error') {
      return {
        status: 'error',
        step: run.step,
        fraction: run.step ? weightBefore(run.step) : 0,
        statusText: run.error ?? 'Failed',
        ...IDLE_DETAIL,
      };
    }

    // Idle: derive completed steps from the cards.
    if (scene.soundCount > 0 && scene.generatedCount === scene.soundCount) {
      return { status: 'done', step: null, fraction: 1, statusText: `${scene.soundCount} sounds`, ...IDLE_DETAIL };
    }
    let fraction = 0;
    if (scenario?.type === 'scenario') {
      const ctx = scene.contextIndex !== null ? analysisConfigs[scene.contextIndex] : undefined;
      if (ctx?.type !== 'model-analysis' || hasModelAnalysisResult(ctx)) fraction += SIMPLE_MODE.STEP_WEIGHTS.analyze;
      if (scenario.scenarioId) fraction += SIMPLE_MODE.STEP_WEIGHTS.scenario;
      if (scenario.foleyResult) fraction += SIMPLE_MODE.STEP_WEIGHTS.foley;
    } else {
      fraction = weightBefore('generate');
    }
    if (scene.soundCount > 0) {
      fraction += SIMPLE_MODE.STEP_WEIGHTS.generate * (scene.generatedCount / scene.soundCount);
    }
    return {
      status: 'incomplete',
      step: run?.step ?? null,
      fraction: clamp01(fraction),
      statusText: run?.status === 'stopped' ? 'Stopped' : 'Not finished',
      ...IDLE_DETAIL,
    };
  }, [
    run, running, step, scene, scenario, analysisConfigs, cardAnalysis, soundConfigs, generatedSounds,
    soundGenCardProgress, soundGenCardStatus, orchestrating, orchestrateThinking,
  ]);
}
