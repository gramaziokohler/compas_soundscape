import { useMemo } from 'react';
import { useAnalysisStore, useSoundscapeStore, useSceneWorkflowStore } from '@/store';
import type { SceneProgress, SceneWorkflowStep, SoundScene } from '@/types/sceneWorkflow';
import { SIMPLE_MODE } from '@/utils/constants';
import { SCENE_WORKFLOW_STEPS, hasModelAnalysisResult } from '@/utils/sceneWorkflow';

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

/**
 * Display state of a scene bubble: status, current step, global advancement
 * (0..1) across the four pipeline steps, and a one-line status text.
 *
 * Running scenes read live store progress; idle scenes derive their state from
 * the cards (scenario / foley results, generated sounds).
 *
 * Usage:
 * ```tsx
 * const { status, fraction, statusText } = useSceneProgress(scene);
 * ```
 */
export function useSceneProgress(scene: SoundScene): SceneProgress {
  const run = useSceneWorkflowStore((s) => s.runs[scene.usageIndex]);
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const analysisStatus = useAnalysisStore((s) => s.analysisStatus);
  const analysisProgress = useAnalysisStore((s) => s.analysisProgress);
  const soundGenProgress = useSoundscapeStore((s) => s.soundGenProgress);
  const soundGenProgressValue = useSoundscapeStore((s) => s.soundGenProgressValue);
  const isOrchestrating = useSoundscapeStore((s) => s.isOrchestrating);

  return useMemo<SceneProgress>(() => {
    if (run?.status === 'queued') {
      return { status: 'queued', step: null, fraction: 0, statusText: 'Queued' };
    }

    if (run?.status === 'running' && run.step) {
      const stepPct = run.step === 'generate' ? soundGenProgressValue : analysisProgress;
      const fraction = clamp01(
        weightBefore(run.step) + SIMPLE_MODE.STEP_WEIGHTS[run.step] * clamp01(stepPct / PERCENT),
      );
      const detail = run.step === 'generate' ? soundGenProgress : analysisStatus;
      const label = run.step === 'generate' && isOrchestrating
        ? SIMPLE_MODE.ORCHESTRATE_LABEL
        : SIMPLE_MODE.STEP_LABELS[run.step];
      return { status: 'running', step: run.step, fraction, statusText: detail ? `${label} · ${detail}` : `${label}…` };
    }

    if (run?.status === 'error') {
      return {
        status: 'error',
        step: run.step,
        fraction: run.step ? weightBefore(run.step) : 0,
        statusText: run.error ?? 'Failed',
      };
    }

    // Idle: derive completed steps from the cards.
    if (scene.soundCount > 0 && scene.generatedCount === scene.soundCount) {
      return { status: 'done', step: null, fraction: 1, statusText: `${scene.soundCount} sounds` };
    }
    const cfg = analysisConfigs[scene.usageIndex];
    let fraction = 0;
    if (cfg?.type === 'scenario') {
      const ctx = scene.contextIndex !== null ? analysisConfigs[scene.contextIndex] : undefined;
      if (ctx?.type !== 'model-analysis' || hasModelAnalysisResult(ctx)) fraction += SIMPLE_MODE.STEP_WEIGHTS.analyze;
      if (cfg.scenarioId) fraction += SIMPLE_MODE.STEP_WEIGHTS.scenario;
      if (cfg.foleyResult) fraction += SIMPLE_MODE.STEP_WEIGHTS.foley;
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
    };
  }, [run, scene, analysisConfigs, analysisStatus, analysisProgress, soundGenProgress, soundGenProgressValue, isOrchestrating]);
}
