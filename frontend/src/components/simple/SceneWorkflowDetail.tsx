'use client';

import { useMemo, type ReactNode } from 'react';
import { useAnalysisStore, useSceneWorkflowStore, useSoundscapeStore } from '@/store';
import type { SceneProgress, SceneWorkflowStep, SoundScene } from '@/types/sceneWorkflow';
import { SceneSettingsSummary } from './SceneSettingsSummary';
import { ThinkingDisclosure } from '@/components/ui/ThinkingDisclosure';
import { SIMPLE_MODE } from '@/utils/constants';
import {
  SCENE_WORKFLOW_STEPS,
  getSceneSoundIndices,
  hasModelAnalysisResult,
  isSoundConfigGenerated,
} from '@/utils/sceneWorkflow';

type StepState = 'done' | 'running' | 'pending' | 'skipped' | 'reused' | 'error';

const PREVIEW_ITEMS = 4;
const PERCENT = 100;

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') {
    return (
      <svg className="animate-spin shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: 'var(--color-primary)' }}>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth={1.6} strokeDasharray="26 12" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'error') {
    return (
      <svg className="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: 'var(--color-error)' }}>
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'done' || state === 'reused') {
    return (
      <svg className="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: 'var(--color-success)' }}>
        <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: 'var(--color-secondary-hover)' }}>
      {state === 'skipped'
        ? <path d="M4 8h8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        : <circle cx="8" cy="8" r="2.5" fill="currentColor" />}
    </svg>
  );
}

export interface SceneWorkflowDetailProps {
  scene: SoundScene;
  progress: SceneProgress;
  onOpenExpert: () => void;
  /** Open the scene's sound cards (shown once some sounds exist). */
  onShowSounds: () => void;
}

/**
 * SceneWorkflowDetail Component
 *
 * Live view of a scene's pipeline: the four steps with their state, a one-line
 * detail taken from the step's card (objects found, scenario events, proposed
 * foley/speech, per-sound generation status), and Stop / Resume actions.
 *
 * Usage:
 * ```tsx
 * <SceneWorkflowDetail scene={scene} progress={progress} onOpenExpert={toExpert} onShowSounds={showSounds} />
 * ```
 */
export function SceneWorkflowDetail({ scene, progress, onOpenExpert, onShowSounds }: SceneWorkflowDetailProps) {
  const analysisConfigs = useAnalysisStore((s) => s.analysisConfigs);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const soundGenCardStatus = useSoundscapeStore((s) => s.soundGenCardStatus);
  const soundGenCardProgress = useSoundscapeStore((s) => s.soundGenCardProgress);
  const soundGenProgressValue = useSoundscapeStore((s) => s.soundGenProgressValue);
  const analysisProgress = useAnalysisStore((s) => s.analysisProgress);
  const analysisThinking = useAnalysisStore((s) => s.analysisThinking);
  const isOrchestrating = useSoundscapeStore((s) => s.isOrchestrating);
  const orchestrateThinking = useSoundscapeStore((s) => s.orchestrateThinking);
  const run = useSceneWorkflowStore((s) => s.runs[scene.usageIndex]);
  const isQueuedOrRunning = useSceneWorkflowStore(
    (s) => s.activeUsageIndex === scene.usageIndex || s.queue.includes(scene.usageIndex),
  );
  const stopScene = useSceneWorkflowStore((s) => s.stopScene);
  const resumeScene = useSceneWorkflowStore((s) => s.resumeScene);

  const scenario = analysisConfigs[scene.usageIndex];
  const context = scene.contextIndex !== null ? analysisConfigs[scene.contextIndex] : undefined;
  const sc = scenario?.type === 'scenario' ? scenario : null;

  const soundIndices = useMemo(
    () => getSceneSoundIndices(soundConfigs, scene.usageIndex),
    [soundConfigs, scene.usageIndex],
  );

  const stepState = (step: SceneWorkflowStep): StepState => {
    if (progress.status === 'running' && progress.step === step) return 'running';
    if (progress.status === 'error' && progress.step === step) return 'error';
    if (step === 'analyze') {
      if (context?.type !== 'model-analysis') return 'skipped';
      if (run?.reusedSteps.includes('analyze')) return 'reused';
      return hasModelAnalysisResult(context) ? 'done' : 'pending';
    }
    if (step === 'scenario') return sc?.scenarioId ? 'done' : 'pending';
    if (step === 'foley') {
      const speechOk = sc?.includeSpeech === false || (sc?.speechResult?.speeches?.length ?? 0) > 0;
      return sc?.foleyResult && speechOk ? 'done' : 'pending';
    }
    return scene.soundCount > 0 && scene.generatedCount === scene.soundCount ? 'done' : 'pending';
  };

  const stepDetail = (step: SceneWorkflowStep, state: StepState): ReactNode => {
    if (state === 'skipped') return 'No model loaded';
    if (state === 'reused') return 'Reused from an earlier scene';
    if (state === 'error') return run?.error ?? 'Failed';
    if (step === 'analyze' && context?.type === 'model-analysis') {
      const objects = context.analysisResult?.architecturalObjects ?? [];
      if (objects.length === 0) return state === 'running' ? 'Reading the model…' : null;
      const names = objects.slice(0, PREVIEW_ITEMS).map((o) => o.name).join(', ');
      return `${objects.length} objects · ${names}${objects.length > PREVIEW_ITEMS ? '…' : ''}`;
    }
    if (step === 'scenario' && sc?.scenarioResult) {
      const first = sc.scenarioResult.scenarios?.[0];
      if (!first) return null;
      if (state === 'running') {
        const last = first.events[first.events.length - 1];
        return last ? `${last.timestamp} · ${last.description}` : first.title;
      }
      return `${first.title} · ${first.events.length} events`;
    }
    if (step === 'foley' && sc) {
      const foley = sc.foleyResult?.scenarios?.flatMap((s) => s.sound_events) ?? [];
      const speeches = sc.speechResult?.speeches ?? [];
      if (foley.length + speeches.length === 0) return state === 'running' ? 'Listening for sound events…' : null;
      if (state === 'running') {
        return foley.slice(-PREVIEW_ITEMS).map((e) => e.soundName).join(', ');
      }
      return `${foley.length} sounds${sc.includeSpeech === false ? '' : ` · ${speeches.length} voices`}`;
    }
    if (step === 'generate' && state === 'running' && isOrchestrating) {
      return 'Scheduling the sounds on the timeline…';
    }
    if (step === 'generate' && scene.soundCount > 0) {
      return `${scene.generatedCount}/${scene.soundCount} sounds`;
    }
    return null;
  };

  const generating = progress.status === 'running' && progress.step === 'generate';
  const orchestrating = generating && isOrchestrating;
  const stepPercent = Math.max(0, Math.min(PERCENT, generating ? soundGenProgressValue : analysisProgress));
  // The orchestrate agent runs inside the generate step; the other agents report through analysisStore.
  const thinking = generating ? (orchestrating ? orchestrateThinking : '') : analysisThinking;

  return (
    <div className="flex flex-col gap-2.5">
      <ol className="flex flex-col gap-2">
        {SCENE_WORKFLOW_STEPS.map((step) => {
          const state = stepState(step);
          const detail = stepDetail(step, state);
          return (
            <li key={step} className={`bubble-step ${state === 'pending' || state === 'skipped' ? 'bubble-step--pending' : ''}`}>
              <span className="mt-0.5"><StepIcon state={state} /></span>
              <div className="min-w-0 flex-1">
                <div>
                  {step === 'generate' && orchestrating ? SIMPLE_MODE.ORCHESTRATE_LABEL : SIMPLE_MODE.STEP_LABELS[step]}
                </div>
                {detail && <div className="bubble-step__meta line-clamp-2">{detail}</div>}
                {state === 'running' && (
                  <>
                    <div className="bubble-progress mt-1">
                      <div className="bubble-progress__value" style={{ width: `${Math.round(stepPercent)}%` }} />
                    </div>
                    <ThinkingDisclosure text={thinking} />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {generating && !orchestrating && soundIndices.length > 0 && (
        <ul className="flex flex-col gap-1 max-h-[min(200px,25dvh)] overflow-y-auto">
          {soundIndices.map((i) => {
            const done = isSoundConfigGenerated(soundConfigs, generatedSounds, i);
            const cfg = soundConfigs[i];
            return (
              <li key={cfg?.config_id ?? i} className="flex items-center gap-2 bubble-step__meta">
                <span className="truncate flex-1" style={{ color: done ? 'var(--foreground)' : undefined }}>
                  {cfg?.display_name || cfg?.prompt || `Sound ${i + 1}`}
                </span>
                <span className="shrink-0">
                  {done ? 'Done' : soundGenCardStatus[i] ?? `${Math.round(soundGenCardProgress[i] ?? 0)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {isQueuedOrRunning ? (
          <button type="button" className="bubble-chip" onClick={() => stopScene(scene.usageIndex)}>
            {progress.status === 'queued' ? 'Cancel' : 'Stop'}
          </button>
        ) : (
          scene.isScenario && progress.status !== 'done' && (
            <button type="button" className="bubble-chip bubble-chip--on" onClick={() => resumeScene(scene.usageIndex)}>
              {progress.status === 'error' ? 'Retry' : 'Resume'}
            </button>
          )
        )}
        {scene.soundCount > 0 && (
          <button type="button" className="bubble-chip" onClick={onShowSounds}>
            Show sounds
          </button>
        )}
        <button type="button" className="bubble-chip" onClick={onOpenExpert}>
          Open in expert mode
        </button>
      </div>

      <SceneSettingsSummary usageIndex={scene.usageIndex} />

    </div>
  );
}
