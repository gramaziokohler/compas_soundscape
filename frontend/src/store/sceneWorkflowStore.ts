/**
 * Scene Workflow Store
 *
 * Orchestrates the Simple-mode one-shot pipeline for a sound scene:
 *   Analyze model → Scenario → Foley + Speech → Generate all sounds.
 *
 * It owns no domain data — every step delegates to the existing stores
 * (analysisStore / soundscapeStore) exactly as the expert cards would, so the
 * same cards fill in live and Expert mode can take over at any point.
 *
 * - One scene runs at a time (analysisStore is single-run); later prompts queue.
 * - Steps are state-derived and idempotent: a step whose result already exists
 *   is skipped. The same runner therefore powers "Resume" after a stop, an
 *   error, or a page refresh.
 * - A scene is identified by its scenario (usage) card index. Runs are
 *   transient (not persisted); a finished run is dropped and the bubble derives
 *   its state from the cards.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AnalyzeModelConfig, ScenarioConfig } from '@/types/analysis';
import type {
  SceneRun,
  SceneWorkflowOptions,
  SceneWorkflowStep,
  UIMode,
} from '@/types/sceneWorkflow';
import { SIMPLE_MODE } from '@/utils/constants';
import type { IndexMapper } from '@/utils/cardIndexRemap';
import { remapIndexKeyedRecord } from '@/utils/cardIndexRemap';
import {
  SCENE_WORKFLOW_STEPS,
  deriveSceneTitle,
  getSceneSoundIndices,
  hasModelAnalysisResult,
  isSoundConfigGenerated,
  workflowStepToWizardStep,
} from '@/utils/sceneWorkflow';
import { useAnalysisStore } from './analysisStore';
import { useSoundscapeStore } from './soundscapeStore';
import { useAudioControlsStore } from './audioControlsStore';
import { useCardFlowStore } from './cardFlowStore';
import { useUIStore } from './uiStore';
import { useRightSidebarStore } from './rightSidebarStore';
import { notifySectionError } from './errorsStore';

// ─── Module-level refs ────────────────────────────────────────────────────────

/**
 * page.tsx's `handleSendAnalysisToGeneration` — it needs the live Speckle
 * viewer to resolve foley object ids into entities, so it cannot live in a store.
 */
let _sendToSoundGeneration: ((usageIndex: number) => void) | null = null;
let _stopRequested = false;
let _pumping = false;

export function registerSendToSoundGeneration(fn: ((usageIndex: number) => void) | null): void {
  _sendToSoundGeneration = fn;
}

class StepError extends Error {}

type StepOutcome = 'ran' | 'reused' | 'skipped';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scenarioAt(index: number): ScenarioConfig | null {
  const cfg = useAnalysisStore.getState().analysisConfigs[index];
  return cfg?.type === 'scenario' ? cfg : null;
}

function speechDone(sc: ScenarioConfig): boolean {
  return sc.includeSpeech === false || (sc.speechResult?.speeches?.length ?? 0) > 0;
}

function failureMessage(fallback: string): string {
  return useAnalysisStore.getState().analysisError || fallback;
}

/**
 * Keep the expert sidebar in step with the pipeline: persisted indices are read
 * when the Sidebar mounts (mode switch), the nav command drives a mounted one.
 */
function syncExpertNavigation(step: 0 | 1 | 2, contextIndex: number | null, usageIndex: number | null): void {
  const ui = useUIStore.getState();
  const flow = useCardFlowStore.getState();
  ui.setSidebarWizardStep(step);
  flow.setActiveContextOriginalIndex(contextIndex);
  if (step >= 1) flow.setActiveUsageOriginalIndex(usageIndex);
  ui.navigateSidebar({ step, contextIndex, usageIndex });
}

/**
 * Find (or create) the context card a new scene hangs under. With `fresh`, a
 * new model-analysis card is always created (re-analysis, e.g. with an attached
 * reference image) so earlier scenes keep the analysis they were built on.
 */
function ensureSceneContext(fresh?: { prompt: string; options: SceneWorkflowOptions }): number {
  const analysis = useAnalysisStore.getState();
  const { globalSpeckleData } = useUIStore.getState();
  const configs = analysis.analysisConfigs;

  if (globalSpeckleData && fresh) {
    const idx = configs.length;
    analysis.handleAddConfig('model-analysis', globalSpeckleData);
    const image = fresh.options.image;
    useAnalysisStore.getState().handleUpdateConfig(idx, {
      userContext: fresh.prompt.trim(),
      llmModel: fresh.options.llmModel,
      ...(image
        ? { liveScreenshots: [image.dataUrl].slice(0, SIMPLE_MODE.MAX_ANALYSIS_SCREENSHOTS), liveScreenshotFilenames: [] }
        : {}),
    } as Partial<AnalyzeModelConfig>);
    return idx;
  }

  if (globalSpeckleData) {
    // Reuse an analyzed model context first, then any model context.
    const analyzed = configs.findIndex((c) => hasModelAnalysisResult(c));
    if (analyzed >= 0) return analyzed;
    const existing = configs.findIndex((c) => c.type === 'model-analysis');
    if (existing >= 0) return existing;
    const idx = configs.length;
    analysis.handleAddConfig('model-analysis', globalSpeckleData);
    return idx;
  }

  // Home sandbox (no model): scenes hang under a freeform context card.
  const freeform = configs.findIndex(
    (c) => c.type === 'freeform' && c.parentContextOriginalIndex === undefined,
  );
  if (freeform >= 0) return freeform;
  const idx = configs.length;
  analysis.handleAddConfig('freeform');
  return idx;
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface SceneWorkflowStoreState {
  /** Runs keyed by scenario (usage) card index. Finished runs are removed. */
  runs: Record<number, SceneRun>;
  /** FIFO of queued usage indices. */
  queue: number[];
  /** Usage index of the scene currently running, or null. */
  activeUsageIndex: number | null;

  /** Create the scene's cards and queue its pipeline. Returns the scene's usage index. */
  startScene: (prompt: string, options: SceneWorkflowOptions) => number;
  /** Re-queue an incomplete scene; completed steps are skipped. */
  resumeScene: (usageIndex: number, options?: Partial<SceneWorkflowOptions>) => void;
  /** Stop the running scene, or drop a queued one. */
  stopScene: (usageIndex: number) => void;
  /** Forget a scene's run state (e.g. after its card is removed). */
  clearRun: (usageIndex: number) => void;
  /**
   * Follow analysis cards across insertion/removal: re-key runs and the queue,
   * and stop (then drop) a scene whose card was removed.
   */
  remapUsageIndices: (mapIndex: IndexMapper) => void;
  /**
   * Scene whose panel Simple mode should open when it mounts (set when leaving
   * Expert mode, so the user lands on the scene they were working on).
   */
  /** The scene panel Simple mode currently has open (null = none); Detailed mode opens the same scene. */
  openSimplePanel: { kind: 'scene' | 'workflow'; usageIndex: number } | null;
  setOpenSimplePanel: (panel: { kind: 'scene' | 'workflow'; usageIndex: number } | null) => void;
  pendingSimpleFocus: number | null;
  consumeSimpleFocus: () => number | null;
  /**
   * Switch Simple/Expert and carry the focus across:
   * - to Expert: expand the left sidebar on the Sounds step of `focusUsageIndex`,
   *   else the selected scene, else the running one (its current step while it
   *   has no sounds yet).
   * - to Simple: open the panel of the scene the expert sidebar was showing.
   */
  switchUIMode: (mode: UIMode, focusUsageIndex?: number) => void;
}

/** Composer defaults — model/language choices start from the app-wide settings. */
export function defaultSceneOptions(): SceneWorkflowOptions {
  return {
    includeSpeech: true,
    durationMs: SIMPLE_MODE.DEFAULT_DURATION_MS,
    audioModel: useSoundscapeStore.getState().audioModel,
    llmModel: useSoundscapeStore.getState().llmModel,
    peopleCount: SIMPLE_MODE.SCENARIO_PEOPLE_COUNT,
    likeliness: SIMPLE_MODE.SCENARIO_LIKELINESS,
    // Empty = keep the app-wide TTS language (Settings › Audio).
    speechLanguage: '',
    image: null,
    reanalyze: false,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSceneWorkflowStore = create<SceneWorkflowStoreState>()(
  devtools(
    (set, get) => {
      const patchRun = (usageIndex: number, patch: Partial<SceneRun>) =>
        set(
          (s) => {
            const run = s.runs[usageIndex];
            if (!run) return s;
            return { runs: { ...s.runs, [usageIndex]: { ...run, ...patch } } };
          },
          false,
          'sceneWorkflow/patchRun',
        );

      // ── Steps ────────────────────────────────────────────────────────────

      async function runAnalyze(run: SceneRun): Promise<StepOutcome> {
        const ctx = useAnalysisStore.getState().analysisConfigs[run.contextIndex];
        if (ctx?.type !== 'model-analysis') return 'skipped';
        if (hasModelAnalysisResult(ctx)) return 'reused';
        syncExpertNavigation(0, run.contextIndex, run.usageIndex);
        if (!ctx.llmModel) {
          useAnalysisStore.getState().handleUpdateConfig(run.contextIndex, { llmModel: run.options.llmModel });
        }
        await useAnalysisStore.getState().handleAnalyze(run.contextIndex);
        if (_stopRequested) return 'ran';
        if (!hasModelAnalysisResult(useAnalysisStore.getState().analysisConfigs[run.contextIndex])) {
          throw new StepError(failureMessage('Model analysis failed'));
        }
        return 'ran';
      }

      async function runScenario(run: SceneRun): Promise<StepOutcome> {
        const sc = scenarioAt(run.usageIndex);
        if (!sc) throw new StepError('Scene card not found');
        if (sc.scenarioId) return 'skipped';
        syncExpertNavigation(1, run.contextIndex, run.usageIndex);
        // Called directly (not via handleAnalyze) so a partially streamed,
        // id-less scenario is regenerated instead of being routed to foley.
        await useAnalysisStore.getState().handleScenarioAnalyze(run.usageIndex);
        if (_stopRequested) return 'ran';
        if (!scenarioAt(run.usageIndex)?.scenarioId) {
          throw new StepError(failureMessage('Scenario generation failed'));
        }
        return 'ran';
      }

      async function runFoley(run: SceneRun): Promise<StepOutcome> {
        const sc = scenarioAt(run.usageIndex);
        if (!sc) throw new StepError('Scene card not found');
        if (sc.foleyResult && speechDone(sc)) return 'skipped';
        syncExpertNavigation(1, run.contextIndex, run.usageIndex);
        // handleAnalyze dispatches a scenario with a result to foley + speech.
        await useAnalysisStore.getState().handleAnalyze(run.usageIndex);
        if (_stopRequested) return 'ran';
        const after = scenarioAt(run.usageIndex);
        const foleyCount = after?.foleyResult?.scenarios?.reduce((n, s) => n + s.sound_events.length, 0) ?? 0;
        const speechCount = after?.speechResult?.speeches?.length ?? 0;
        if (foleyCount + speechCount === 0) {
          throw new StepError(failureMessage('No sounds were proposed for this scenario'));
        }
        return 'ran';
      }

      async function runGenerate(run: SceneRun): Promise<StepOutcome> {
        syncExpertNavigation(2, run.contextIndex, run.usageIndex);
        // The scene being generated becomes the one shown in the DAW / 3D scene.
        useUIStore.getState().setActiveSoundParentIndex(run.usageIndex);

        let indices = getSceneSoundIndices(useSoundscapeStore.getState().soundConfigs, run.usageIndex);
        if (indices.length === 0) {
          if (!_sendToSoundGeneration) throw new StepError('Sound generation is not ready yet');
          _sendToSoundGeneration(run.usageIndex);
          indices = getSceneSoundIndices(useSoundscapeStore.getState().soundConfigs, run.usageIndex);
          if (indices.length === 0) throw new StepError('No sounds to generate for this scene');
          const { handleUpdateConfig } = useSoundscapeStore.getState();
          indices.forEach((i) => handleUpdateConfig(i, 'steps', SIMPLE_MODE.DIFFUSION_STEPS));
        }

        const sound = useSoundscapeStore.getState();
        if (sound.audioModel !== run.options.audioModel) sound.setAudioModel(run.options.audioModel);

        const pending = indices.filter(
          (i) => !isSoundConfigGenerated(sound.soundConfigs, sound.generatedSounds, i),
        );
        if (pending.length === 0) return 'skipped';

        // Mirrors SoundGenerationSection.handleGenerateAll.
        if (pending.some((i) => sound.soundConfigs[i]?.orchestrateMeta)) {
          const audio = useAudioControlsStore.getState();
          audio.setGenerationInProgress(true);
          audio.bakeOrchestrateSchedule();
        }
        await useSoundscapeStore.getState().handleGenerateFiltered(pending);
        if (_stopRequested) return 'ran';

        const after = useSoundscapeStore.getState();
        const anyGenerated = indices.some((i) =>
          isSoundConfigGenerated(after.soundConfigs, after.generatedSounds, i),
        );
        if (!anyGenerated) throw new StepError(after.soundGenError || 'Sound generation failed');
        return 'ran';
      }

      const STEP_RUNNERS: Record<SceneWorkflowStep, (run: SceneRun) => Promise<StepOutcome>> = {
        analyze: runAnalyze,
        scenario: runScenario,
        foley: runFoley,
        generate: runGenerate,
      };

      // ── Runner ───────────────────────────────────────────────────────────

      /**
       * Runs the active scene. Its usage index is re-read before each step because
       * removing an earlier card shifts it (remapUsageIndices); null = card removed.
       */
      async function runWorkflow(): Promise<void> {
        _stopRequested = false;
        let usageIndex = get().activeUsageIndex;
        for (const step of SCENE_WORKFLOW_STEPS) {
          usageIndex = get().activeUsageIndex;
          if (usageIndex === null) return;
          const run = get().runs[usageIndex];
          if (!run) return;
          if (_stopRequested) {
            patchRun(usageIndex, { status: 'stopped' });
            return;
          }
          patchRun(usageIndex, { step, status: 'running' });
          try {
            const outcome = await STEP_RUNNERS[step](run);
            usageIndex = get().activeUsageIndex;
            if (usageIndex === null) return;
            if (outcome === 'reused') {
              patchRun(usageIndex, { reusedSteps: [...(get().runs[usageIndex]?.reusedSteps ?? []), step] });
            }
          } catch (err) {
            usageIndex = get().activeUsageIndex;
            if (usageIndex === null) return;
            const message = err instanceof Error ? err.message : 'Scene generation failed';
            patchRun(usageIndex, { status: 'error', error: message });
            // Store-level failures were already toasted by the store itself.
            if (err instanceof StepError) notifySectionError(message);
            return;
          }
          if (_stopRequested) {
            patchRun(usageIndex, { status: 'stopped' });
            return;
          }
        }
        // Finished — the bubble now derives its state from the cards.
        if (usageIndex !== null) get().clearRun(usageIndex);
      }

      async function pump(): Promise<void> {
        // A separate lock: activeUsageIndex goes null when the running scene's card is
        // removed, but its in-flight step still has to unwind before the next starts.
        if (_pumping) return;
        const [next, ...rest] = get().queue;
        if (next === undefined) return;
        _pumping = true;
        set({ queue: rest, activeUsageIndex: next }, false, 'sceneWorkflow/dequeue');
        try {
          await runWorkflow();
        } finally {
          _pumping = false;
          set({ activeUsageIndex: null }, false, 'sceneWorkflow/runEnd');
          void pump();
        }
      }

      function enqueue(run: SceneRun): void {
        set(
          (s) => ({
            runs: { ...s.runs, [run.usageIndex]: run },
            queue: s.queue.includes(run.usageIndex) ? s.queue : [...s.queue, run.usageIndex],
          }),
          false,
          'sceneWorkflow/enqueue',
        );
        void pump();
      }

      return {
        runs: {},
        queue: [],
        activeUsageIndex: null,

        startScene: (prompt, options) => {
          const contextIndex = ensureSceneContext(options.reanalyze ? { prompt, options } : undefined);
          // The speech language is the app-wide TTS setting (also used when the
          // speech lines are voiced) — the composer is a shortcut to it.
          const audio = useAudioControlsStore.getState();
          if (options.speechLanguage && options.speechLanguage !== audio.ttsLanguage) {
            audio.setTtsLanguage(options.speechLanguage);
          }
          const analysis = useAnalysisStore.getState();
          const usageIndex = analysis.analysisConfigs.length;
          analysis.handleAddConfig('scenario');
          useAnalysisStore.getState().handleUpdateConfig(usageIndex, {
            parentContextOriginalIndex: contextIndex,
            // Empty prompt (model loaded): no provisional title — the scenario title takes over.
            display_name: deriveSceneTitle(prompt) || undefined,
            userContext: prompt.trim(),
            peopleCount: options.peopleCount,
            likeliness: options.likeliness,
            llmModel: options.llmModel,
            timelineDurationMs: options.durationMs,
            includeSpeech: options.includeSpeech,
            useAnalysisResult: !!useUIStore.getState().globalSpeckleData,
            // The reference image also grounds the scenario directly — the only
            // way it is used when no model is loaded (no analysis to re-run).
            referenceImages: options.image ? [options.image.dataUrl] : undefined,
          } as Partial<ScenarioConfig>);

          enqueue({
            usageIndex,
            contextIndex,
            options,
            status: 'queued',
            step: null,
            reusedSteps: [],
            error: null,
          });
          return usageIndex;
        },

        resumeScene: (usageIndex, options) => {
          const sc = scenarioAt(usageIndex);
          if (!sc || get().activeUsageIndex === usageIndex || get().queue.includes(usageIndex)) return;
          const prev = get().runs[usageIndex];
          enqueue({
            usageIndex,
            contextIndex: sc.parentContextOriginalIndex ?? ensureSceneContext(),
            options: { ...(prev?.options ?? defaultSceneOptions()), ...options },
            status: 'queued',
            step: prev?.step ?? null,
            reusedSteps: [],
            error: null,
          });
        },

        stopScene: (usageIndex) => {
          if (get().activeUsageIndex === usageIndex) {
            _stopRequested = true;
            useAnalysisStore.getState().handleStopAnalysis();
            useSoundscapeStore.getState().handleStopGeneration();
            return;
          }
          if (get().queue.includes(usageIndex)) {
            set((s) => ({ queue: s.queue.filter((i) => i !== usageIndex) }), false, 'sceneWorkflow/dequeueStopped');
            patchRun(usageIndex, { status: 'stopped' });
          }
        },

        clearRun: (usageIndex) =>
          set(
            (s) => {
              if (!(usageIndex in s.runs)) return s;
              const { [usageIndex]: _removed, ...runs } = s.runs;
              return { runs };
            },
            false,
            'sceneWorkflow/clearRun',
          ),

        remapUsageIndices: (mapIndex) => {
          const { activeUsageIndex } = get();
          if (activeUsageIndex !== null && mapIndex(activeUsageIndex) === null) {
            get().stopScene(activeUsageIndex);
          }
          set(
            (s) => ({
              runs: remapIndexKeyedRecord(s.runs, mapIndex, (run, usageIndex) => ({
                ...run,
                usageIndex,
                contextIndex: mapIndex(run.contextIndex) ?? run.contextIndex,
              })),
              queue: s.queue.map(mapIndex).filter((i): i is number => i !== null),
              activeUsageIndex: s.activeUsageIndex === null ? null : mapIndex(s.activeUsageIndex),
            }),
            false,
            'sceneWorkflow/remapUsageIndices',
          );
        },

        openSimplePanel: null,
        setOpenSimplePanel: (panel) => set({ openSimplePanel: panel }, false, 'sceneWorkflow/setOpenSimplePanel'),

        pendingSimpleFocus: null,
        consumeSimpleFocus: () => {
          const focus = get().pendingSimpleFocus;
          if (focus !== null) set({ pendingSimpleFocus: null }, false, 'sceneWorkflow/consumeSimpleFocus');
          return focus;
        },

        switchUIMode: (mode, focusUsageIndex) => {
          const ui = useUIStore.getState();
          if (mode === 'expert') {
            const { activeUsageIndex, runs, openSimplePanel } = get();
            const selected = ui.isInSoundsStep ? ui.activeSoundParentIndex : null;
            // The scene whose circle is expanded in Simple mode wins, so Detailed
            // mode opens the same cards / sections.
            const target = focusUsageIndex ?? openSimplePanel?.usageIndex ?? selected ?? activeUsageIndex;
            if (target !== null && target >= 0) {
              const cfg = useAnalysisStore.getState().analysisConfigs[target];
              const hasSounds =
                getSceneSoundIndices(useSoundscapeStore.getState().soundConfigs, target).length > 0;
              const run = runs[target];
              const showsWorkflowStep = openSimplePanel?.kind === 'workflow' && openSimplePanel.usageIndex === target && !!run;
              const step = showsWorkflowStep
                ? workflowStepToWizardStep(run.step)
                : hasSounds ? 2 : run ? workflowStepToWizardStep(run.step) : 1;
              syncExpertNavigation(step, cfg?.parentContextOriginalIndex ?? run?.contextIndex ?? null, target);
            }
            // The Sidebar reads its expanded state from the persisted store on mount.
            // Via the command (not just the flag): a Home-load collapse command is
            // still stored and the mounting Sidebar would replay it over the flag.
            ui.setLeftSidebarExpandCommand(true);
            // Expand the right sidebar too (Object Explorer / entity info).
            useRightSidebarStore.getState().requestExpand();
          } else {
            const flow = useCardFlowStore.getState();
            const shown = ui.sidebarWizardStep === 2
              ? (ui.activeSoundParentIndex ?? flow.activeUsageOriginalIndex)
              : flow.activeUsageOriginalIndex;
            set({ pendingSimpleFocus: focusUsageIndex ?? shown ?? null }, false, 'sceneWorkflow/setSimpleFocus');
          }
          ui.setUIMode(mode);
        },
      };
    },
    { name: 'sceneWorkflowStore' },
  ),
);
