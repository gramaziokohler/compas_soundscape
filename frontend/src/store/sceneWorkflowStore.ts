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
 * - Scenes run concurrently and independently — there is no frontend queue.
 *   LLM jobs are throttled by the backend LLM pool, generation jobs by the
 *   backend worker queues. Stopping or removing one scene never touches another.
 * - Scenes sharing an un-analyzed model context wait for one analysis of it.
 * - Steps are state-derived and idempotent: a step whose result already exists
 *   is skipped. The same runner therefore powers "Resume" after a stop, an
 *   error, or a page refresh.
 * - A scene is identified by its scenario (usage) card index; its run carries a
 *   stable `runId` since that index shifts when an earlier card is removed.
 *   Runs are transient (not persisted); a finished run is dropped and the bubble
 *   derives its state from the cards.
 * - Only the focus scene (selectFocusRun) drives the expert sidebar and the
 *   DAW / 3D scene; background scenes never steal them.
 */

import { create } from 'zustand';
import { logStudyEvent } from '@/lib/study/studyLogger';
import { devtools } from 'zustand/middleware';
import type { AnalyzeModelConfig, ScenarioConfig } from '@/types/analysis';
import type {
  SceneRun,
  SceneWorkflowOptions,
  SceneWorkflowStep,
  UIMode,
} from '@/types/sceneWorkflow';
import { DEFAULT_FOLEY_SOUND_DETAIL, SIMPLE_MODE } from '@/utils/constants';
import type { IndexMapper } from '@/utils/cardIndexRemap';
import { remapIndexKeyedRecord } from '@/utils/cardIndexRemap';
import { createLiveIndexRegistry, type LiveIndexRef } from '@/utils/liveIndexRegistry';
import { newConfigId } from '@/utils/config-id';
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

/** Run ids whose scene was asked to stop (checked between and after steps). */
const _stopRequested = new Set<string>();

/**
 * In-flight model analyses started by a scene, keyed by a live ref of the
 * context card, so concurrent scenes on the same context analyze it once.
 */
const contextRefs = createLiveIndexRegistry();
const _contextAnalyses = new Map<LiveIndexRef, Promise<void>>();

export function registerSendToSoundGeneration(fn: ((usageIndex: number) => void) | null): void {
  _sendToSoundGeneration = fn;
}

class StepError extends Error {}
/** The scene's card was removed (or the run replaced by a resume) — unwind silently. */
class SceneGoneError extends Error {}

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

function inFlightContextAnalysis(contextIndex: number): Promise<void> | undefined {
  for (const [ref, promise] of _contextAnalyses) {
    if (ref.current === contextIndex) return promise;
  }
  return undefined;
}

function trackContextAnalysis(contextIndex: number, promise: Promise<void>): void {
  const ref = contextRefs.track(contextIndex);
  _contextAnalyses.set(ref, promise);
  void promise.finally(() => {
    _contextAnalyses.delete(ref);
    contextRefs.release(ref);
  });
}

/**
 * Keep the expert sidebar in step with the pipeline: persisted indices are read
 * when the Sidebar mounts (mode switch), the nav command drives a mounted one.
 */
export function syncExpertNavigation(step: 0 | 1 | 2, contextIndex: number | null, usageIndex: number | null): void {
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

  /** Create the scene's cards and start its pipeline at once. Returns the scene's usage index. */
  startScene: (prompt: string, options: SceneWorkflowOptions) => number;
  /** Restart an incomplete scene; completed steps are skipped. */
  resumeScene: (usageIndex: number, options?: Partial<SceneWorkflowOptions>) => void;
  /** Stop one running scene (other scenes keep running). */
  stopScene: (usageIndex: number) => void;
  /** Forget a scene's run state (e.g. after its card is removed). */
  clearRun: (usageIndex: number) => void;
  /**
   * Follow analysis cards across insertion/removal: re-key runs, and stop a
   * scene whose card was removed (its in-flight jobs were already stopped).
   */
  remapUsageIndices: (mapIndex: IndexMapper) => void;
  /** The scene panel Simple mode currently has open (null = none); Detailed mode opens the same scene. */
  openSimplePanel: { kind: 'scene' | 'workflow'; usageIndex: number } | null;
  setOpenSimplePanel: (panel: { kind: 'scene' | 'workflow'; usageIndex: number } | null) => void;
  /** Simple mode: which overlapping window was clicked last and is drawn in front (scene panel or docked DAW). */
  simpleFrontLayer: 'panel' | 'daw';
  setSimpleFrontLayer: (layer: 'panel' | 'daw') => void;
  /**
   * Scene whose panel Simple mode should open when it mounts (set when leaving
   * Expert mode, so the user lands on the scene they were working on).
   */
  pendingSimpleFocus: number | null;
  consumeSimpleFocus: () => number | null;
  /**
   * Switch Simple/Expert and carry the focus across:
   * - to Expert: expand the left sidebar on the Sounds step of `focusUsageIndex`,
   *   else the selected scene, else the focus run (its current step while it
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
    soundDetail: DEFAULT_FOLEY_SOUND_DETAIL,
    // Empty = keep the app-wide TTS language (Settings › Audio).
    speechLanguage: '',
    image: null,
    reanalyze: false,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Whether any scene's pipeline is running. */
export function selectHasRunningScene(s: Pick<SceneWorkflowStoreState, 'runs'>): boolean {
  return Object.values(s.runs).some((r) => r.status === 'running');
}

/**
 * The running scene that drives the expert sidebar / DAW / 3D highlights: the
 * one whose Simple-mode panel is open, else the most recently started.
 */
export function selectFocusRun(
  s: Pick<SceneWorkflowStoreState, 'runs' | 'openSimplePanel'>,
): SceneRun | null {
  let latest: SceneRun | null = null;
  for (const run of Object.values(s.runs)) {
    if (run.status !== 'running') continue;
    if (s.openSimplePanel?.usageIndex === run.usageIndex) return run;
    if (!latest || run.startedAt > latest.startedAt) latest = run;
  }
  return latest;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSceneWorkflowStore = create<SceneWorkflowStoreState>()(
  devtools(
    (set, get) => {
      /** The run with this id, at its current usage index (undefined once removed / replaced). */
      const currentRun = (runId: string): SceneRun | undefined =>
        Object.values(get().runs).find((r) => r.runId === runId);

      /** `currentRun`, or unwind the scene's loop when it is gone. */
      const requireRun = (runId: string): SceneRun => {
        const run = currentRun(runId);
        if (!run) throw new SceneGoneError();
        return run;
      };

      const isStopped = (runId: string) => _stopRequested.has(runId);

      const isFocus = (runId: string) => selectFocusRun(get())?.runId === runId;

      const patchRun = (runId: string, patch: Partial<SceneRun>) => {
        if (patch.status !== undefined || patch.step !== undefined) {
          logStudyEvent('scene_workflow.step', {
            run_id: runId,
            step: patch.step ?? null,
            status: patch.status ?? null,
            error: patch.error ?? null,
          });
        }
        set(
          (s) => {
            const run = Object.values(s.runs).find((r) => r.runId === runId);
            if (!run) return s;
            return { runs: { ...s.runs, [run.usageIndex]: { ...run, ...patch } } };
          },
          false,
          'sceneWorkflow/patchRun',
        );
      };

      /** Navigate the expert sidebar to this run's step — only for the focus scene. */
      const navigateIfFocus = (run: SceneRun, step: 0 | 1 | 2) => {
        if (isFocus(run.runId)) syncExpertNavigation(step, run.contextIndex, run.usageIndex);
      };

      // ── Steps ────────────────────────────────────────────────────────────
      // Each step re-reads its run after every await: removing an earlier card
      // shifts the scene's indices (remapUsageIndices re-keys the run).

      async function runAnalyze(runId: string): Promise<StepOutcome> {
        const run = requireRun(runId);
        const ctx = useAnalysisStore.getState().analysisConfigs[run.contextIndex];
        if (ctx?.type !== 'model-analysis') return 'skipped';
        if (hasModelAnalysisResult(ctx)) return 'reused';
        navigateIfFocus(run, 0);

        // Another scene on the same context is already analyzing it — wait for that run.
        const pending = inFlightContextAnalysis(run.contextIndex);
        if (pending) {
          await pending;
        } else {
          if (!ctx.llmModel) {
            useAnalysisStore.getState().handleUpdateConfig(run.contextIndex, { llmModel: run.options.llmModel });
          }
          const analysis = useAnalysisStore.getState().handleAnalyze(run.contextIndex);
          trackContextAnalysis(run.contextIndex, analysis);
          await analysis;
        }
        if (isStopped(runId)) return 'ran';
        const after = requireRun(runId);
        if (!hasModelAnalysisResult(useAnalysisStore.getState().analysisConfigs[after.contextIndex])) {
          throw new StepError(failureMessage('Model analysis failed'));
        }
        return 'ran';
      }

      async function runScenario(runId: string): Promise<StepOutcome> {
        const run = requireRun(runId);
        const sc = scenarioAt(run.usageIndex);
        if (!sc) throw new StepError('Scene card not found');
        if (sc.scenarioId) return 'skipped';
        navigateIfFocus(run, 1);
        // Called directly (not via handleAnalyze) so a partially streamed,
        // id-less scenario is regenerated instead of being routed to foley.
        await useAnalysisStore.getState().handleScenarioAnalyze(run.usageIndex);
        if (isStopped(runId)) return 'ran';
        if (!scenarioAt(requireRun(runId).usageIndex)?.scenarioId) {
          throw new StepError(failureMessage('Scenario generation failed'));
        }
        return 'ran';
      }

      async function runFoley(runId: string): Promise<StepOutcome> {
        const run = requireRun(runId);
        const sc = scenarioAt(run.usageIndex);
        if (!sc) throw new StepError('Scene card not found');
        if (sc.foleyResult && speechDone(sc)) return 'skipped';
        navigateIfFocus(run, 1);
        // handleAnalyze dispatches a scenario with a result to foley + speech.
        await useAnalysisStore.getState().handleAnalyze(run.usageIndex);
        if (isStopped(runId)) return 'ran';
        const after = scenarioAt(requireRun(runId).usageIndex);
        const foleyCount = after?.foleyResult?.scenarios?.reduce((n, s) => n + s.sound_events.length, 0) ?? 0;
        const speechCount = after?.speechResult?.speeches?.length ?? 0;
        if (foleyCount + speechCount === 0) {
          throw new StepError(failureMessage('No sounds were proposed for this scenario'));
        }
        return 'ran';
      }

      async function runGenerate(runId: string): Promise<StepOutcome> {
        const run = requireRun(runId);
        navigateIfFocus(run, 2);
        // The focus scene becomes the one shown in the DAW / 3D scene.
        if (isFocus(runId)) useUIStore.getState().setActiveSoundParentIndex(run.usageIndex);

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
        const pending = indices.filter(
          (i) => !isSoundConfigGenerated(sound.soundConfigs, sound.generatedSounds, i),
        );
        if (pending.length === 0) return 'skipped';

        // Submitted at once — the backend worker queues order the heavy jobs.
        // The model is per invocation, so concurrent scenes never flip the app-wide one.
        const outcome = await sound.handleGenerateFiltered(pending, { audioModel: run.options.audioModel });
        if (isStopped(runId)) return 'ran';

        const after = useSoundscapeStore.getState();
        const anyGenerated = getSceneSoundIndices(after.soundConfigs, requireRun(runId).usageIndex).some((i) =>
          isSoundConfigGenerated(after.soundConfigs, after.generatedSounds, i),
        );
        if (!anyGenerated) throw new StepError(outcome.error || 'Sound generation failed');
        return 'ran';
      }

      const STEP_RUNNERS: Record<SceneWorkflowStep, (runId: string) => Promise<StepOutcome>> = {
        analyze: runAnalyze,
        scenario: runScenario,
        foley: runFoley,
        generate: runGenerate,
      };

      // ── Runner ───────────────────────────────────────────────────────────

      /** Runs one scene's pipeline; any number run concurrently. */
      async function runWorkflow(runId: string): Promise<void> {
        try {
          for (const step of SCENE_WORKFLOW_STEPS) {
            if (!currentRun(runId)) return;
            if (isStopped(runId)) {
              patchRun(runId, { status: 'stopped' });
              return;
            }
            patchRun(runId, { step, status: 'running' });
            try {
              const outcome = await STEP_RUNNERS[step](runId);
              if (outcome === 'reused') {
                patchRun(runId, { reusedSteps: [...(currentRun(runId)?.reusedSteps ?? []), step] });
              }
            } catch (err) {
              if (err instanceof SceneGoneError) return;
              if (isStopped(runId)) {
                patchRun(runId, { status: 'stopped' });
                return;
              }
              const message = err instanceof Error ? err.message : 'Scene generation failed';
              patchRun(runId, { status: 'error', error: message });
              // Store-level failures were already toasted by the store itself.
              if (err instanceof StepError) notifySectionError(message);
              return;
            }
            if (isStopped(runId)) {
              patchRun(runId, { status: 'stopped' });
              return;
            }
          }
          // Finished — the bubble now derives its state from the cards.
          const done = currentRun(runId);
          if (done) get().clearRun(done.usageIndex);
        } finally {
          _stopRequested.delete(runId);
        }
      }

      /** Register a run as running and start its loop right away. */
      function launch(run: Omit<SceneRun, 'runId' | 'startedAt' | 'status' | 'error' | 'reusedSteps'>): void {
        const runId = newConfigId();
        set(
          (s) => ({
            runs: {
              ...s.runs,
              [run.usageIndex]: {
                ...run,
                runId,
                startedAt: Date.now(),
                status: 'running',
                reusedSteps: [],
                error: null,
              },
            },
          }),
          false,
          'sceneWorkflow/launch',
        );
        void runWorkflow(runId);
      }

      return {
        runs: {},

        startScene: (prompt, options) => {
          logStudyEvent('scene_workflow.start', { prompt, options: options as unknown as Record<string, unknown> });
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
            soundDetail: options.soundDetail,
            useAnalysisResult: !!useUIStore.getState().globalSpeckleData,
            // The reference image also grounds the scenario directly — the only
            // way it is used when no model is loaded (no analysis to re-run).
            referenceImages: options.image ? [options.image.dataUrl] : undefined,
          } as Partial<ScenarioConfig>);

          launch({ usageIndex, contextIndex, options, step: null });
          return usageIndex;
        },

        resumeScene: (usageIndex, options) => {
          const sc = scenarioAt(usageIndex);
          const prev = get().runs[usageIndex];
          if (!sc || prev?.status === 'running') return;
          // A new run id: a stopped loop still unwinding sees its run replaced and exits.
          launch({
            usageIndex,
            contextIndex: sc.parentContextOriginalIndex ?? ensureSceneContext(),
            options: { ...(prev?.options ?? defaultSceneOptions()), ...options },
            step: prev?.step ?? null,
          });
        },

        stopScene: (usageIndex) => {
          const run = get().runs[usageIndex];
          if (!run || run.status !== 'running') return;
          logStudyEvent('scene_workflow.stop', { run_id: run.runId, usage_index: usageIndex, step: run.step });
          _stopRequested.add(run.runId);
          patchRun(run.runId, { status: 'stopped' });
          const analysis = useAnalysisStore.getState();
          analysis.handleStopCardAnalysis(usageIndex);
          // The model context is shared — stop its analysis only when no other
          // running scene is waiting on it.
          const contextShared = Object.values(get().runs).some(
            (r) => r.runId !== run.runId && r.status === 'running' && r.contextIndex === run.contextIndex,
          );
          if (!contextShared) analysis.handleStopCardAnalysis(run.contextIndex);
          const soundIndices = getSceneSoundIndices(useSoundscapeStore.getState().soundConfigs, usageIndex);
          if (soundIndices.length > 0) useSoundscapeStore.getState().handleStopGenerationFor(soundIndices);
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
          contextRefs.remap(mapIndex);
          // A removed scene's loop must not continue (its cards' jobs were stopped
          // by the analysis / sound stores when the cards went away).
          Object.values(get().runs).forEach((run) => {
            if (run.status === 'running' && mapIndex(run.usageIndex) === null) _stopRequested.add(run.runId);
          });
          set(
            (s) => ({
              runs: remapIndexKeyedRecord(s.runs, mapIndex, (run, usageIndex) => ({
                ...run,
                usageIndex,
                contextIndex: mapIndex(run.contextIndex) ?? run.contextIndex,
              })),
            }),
            false,
            'sceneWorkflow/remapUsageIndices',
          );
        },

        openSimplePanel: null,
        setOpenSimplePanel: (panel) => set({ openSimplePanel: panel }, false, 'sceneWorkflow/setOpenSimplePanel'),

        simpleFrontLayer: 'daw',
        // Called on every DAW pointerdown — skip the no-op commits.
        setSimpleFrontLayer: (layer) => {
          if (get().simpleFrontLayer !== layer) set({ simpleFrontLayer: layer }, false, 'sceneWorkflow/setSimpleFrontLayer');
        },

        pendingSimpleFocus: null,
        consumeSimpleFocus: () => {
          const focus = get().pendingSimpleFocus;
          if (focus !== null) set({ pendingSimpleFocus: null }, false, 'sceneWorkflow/consumeSimpleFocus');
          return focus;
        },

        switchUIMode: (mode, focusUsageIndex) => {
          const ui = useUIStore.getState();
          if (mode === 'expert') {
            const { runs, openSimplePanel } = get();
            const selected = ui.isInSoundsStep ? ui.activeSoundParentIndex : null;
            // The scene whose circle is expanded in Simple mode wins, so Detailed
            // mode opens the same cards / sections.
            const target =
              focusUsageIndex ?? openSimplePanel?.usageIndex ?? selected ?? selectFocusRun(get())?.usageIndex ?? null;
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
