/**
 * Scene Workflow Types
 *
 * Types for the Simple (bubble) UI mode and its one-shot sound-scene pipeline:
 * Analyze model → Scenario → Foley + Speech → Generate all sounds.
 */

/** Top-level UI presentation. `simple` = floating bubbles, `expert` = sidebars + cards. */
export type UIMode = 'simple' | 'expert';

/** Pipeline steps, in execution order. */
export type SceneWorkflowStep = 'analyze' | 'scenario' | 'foley' | 'generate';

/** A reference image attached in the composer (fed to model analysis as a screenshot). */
export interface SceneReferenceImage {
  name: string;
  /** base64 data URI — the format model analysis accepts for screenshots. */
  dataUrl: string;
}

/** Options chosen in the prompt composer for one scene. */
export interface SceneWorkflowOptions {
  includeSpeech: boolean;
  /** Length of the generated scene timeline (ms). */
  durationMs: number;
  /** Text-to-audio model used for the generate step (AUDIO_MODEL_* constant). */
  audioModel: string;
  /** LLM for the model analysis + scenario / foley / speech agents (LLM_MODEL_* constant). */
  llmModel: string;
  /** Scenario agent: number of people in the scene. */
  peopleCount: number;
  /** Scenario agent: plausibility of the scenario (1 = unusual … 10 = typical). */
  likeliness: number;
  /** Language of the generated speech, free text (e.g. "Swiss German"). Empty keeps
   *  the app-wide TTS language; otherwise it becomes the app-wide TTS language. */
  speechLanguage: string;
  /** Optional reference image for the model analysis. */
  image: SceneReferenceImage | null;
  /** Run a fresh model analysis for this scene (defaults to true once an image is attached). */
  reanalyze: boolean;
}

export type SceneRunStatus = 'queued' | 'running' | 'error' | 'stopped';

/** Runtime state of one scene workflow, keyed by its scenario card index. */
export interface SceneRun {
  usageIndex: number;
  contextIndex: number;
  options: SceneWorkflowOptions;
  status: SceneRunStatus;
  /** Step currently executing (or the one that failed / was stopped). */
  step: SceneWorkflowStep | null;
  /** Steps skipped because their result already existed (e.g. reused model analysis). */
  reusedSteps: SceneWorkflowStep[];
  error: string | null;
}

/** Derived per-scene display state for a bubble. */
export type SceneBubbleStatus = 'queued' | 'running' | 'error' | 'incomplete' | 'done';

export interface SceneProgress {
  status: SceneBubbleStatus;
  step: SceneWorkflowStep | null;
  /** Global advancement across all steps, 0..1. */
  fraction: number;
  statusText: string;
}

/** One sound scene (a usage card with its sound children) shown as a bubble. */
export interface SoundScene {
  usageIndex: number;
  contextIndex: number | null;
  title: string;
  /** Untrimmed title (the full prompt when the scene was created from one). */
  fullTitle: string;
  isScenario: boolean;
  soundCount: number;
  generatedCount: number;
}
