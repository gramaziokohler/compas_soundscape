/**
 * Soundscape Store
 *
 * Replaces useSoundGeneration. Manages sound configuration cards, sound
 * generation (backend/ElevenLabs/library/upload), and the resulting
 * soundscape event data.
 *
 * geometryBounds is now read from useFileUploadStore instead of being a prop.
 * AbortController is kept as a module-level ref (non-serializable).
 *
 * Undo covers cards, generated events and global settings (see the Undo section).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import type {
  SoundGenerationConfig,
  CardType,
  LibrarySearchResult,
  CatalogSoundSelection,
  SoundEvent,
  GenerateSoundsOptions,
  GenerateSoundsOutcome,
} from '@/types';
import { createLiveIndexRegistry, type LiveIndexRef } from '@/utils/liveIndexRegistry';
import {
  createInsertionIndexMapper,
  createMoveIndexMapper,
  createRemovalIndexMapper,
  remapIndexKeyedRecord,
  type IndexMapper,
} from '@/utils/cardIndexRemap';
import {
  API_BASE_URL,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_DIFFUSION_STEPS,
  DEFAULT_SEED_COPIES,
  DEFAULT_AUDIO_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_TTS_MODEL,
  normalizeLlmModel,
  normalizeTtsModel,
  AUDIO_MODEL_ELEVENLABS,
  LIBRARY_MAX_SEARCH_RESULTS,
  DUPLICATE_POSITION_OFFSET,
  DEFAULT_DBFS,
  DBFS_MIN,
  DBFS_MAX,
  TTS_DEFAULT_VOICE,
  DEFAULT_PROMPT_INFLUENCE,
  DEFAULT_SOUND_LOOP,
  ELEVENLABS_MIN_PROMPT_DURATION,
  normalizeSoundCategory,
  SOUND_GEN_CONCURRENCY,
} from '@/utils/constants';
import { mapWithConcurrency } from '@/utils/concurrency';
import { loadAudioFile, revokeAudioUrl } from '@/lib/audio/utils/audio-upload';
import { parseTriggerExpression } from '@/lib/audio/utils/trigger-ref';
import { calculateSoundPosition, type GeometryBounds } from '@/utils/positioning';
import { createSoundEventFromUpload, generatedEventFieldsFromConfig } from '@/utils/event-factory';
import { cardEventId, configIdsByPromptIndex, newConfigId } from '@/utils/config-id';
import { parseSoundCopyIndex } from '@/lib/audio/utils/variant-sound-id';
import {
  captureGenerationSignature,
  captureVariantSignature,
  getGenerationRevertPatch,
  getVariantSettingsPatch,
} from '@/utils/generationSignature';
import { generateSoundEffect } from '@/services/elevenlabs';
import { apiService } from '@/services/api';
import { notifySectionError } from './errorsStore';
import { useFileUploadStore } from './fileUploadStore';
import { useAudioControlsStore } from './audioControlsStore';
import { useCardFlowStore } from './cardFlowStore';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import { startPolling, createPollRegistry } from '@/lib/poll-until-done';
import {
  UNDO_HISTORY_LIMIT,
  undoEquality,
  runWithoutUndo,
  rebaseUndoHistory,
  type RegisterTemporalStoreOptions,
} from './undoRedoRegistry';
import { scheduleUndoSafeDeletion } from '@/lib/undo-safe-deletion';

// ─── Module-level concurrency state ──────────────────────────────────────────
// Multiple generations may run at once (e.g. TTA on the GPU pool while a
// catalog card is downloaded client-side). All handles are therefore stored in
// per-invocation registries rather than singletons, so one job's `finally`
// can never clear another job's poll loop.

const soundPollRegistry = createPollRegistry();
const orchestratePollRegistry = createPollRegistry();
const _activeSoundJobIds = new Set<string>();
const _activeTtsJobIds = new Set<string>();
const _activeOrchestrateJobIds = new Set<string>();
const _abortControllers = new Set<AbortController>();

/**
 * One in-flight generation invocation. Simple-mode scenes generate
 * concurrently, so a stop can target one scene's invocation (its cards) while
 * the others keep running.
 */
interface GenerationInvocation {
  controller: AbortController;
  /** Live refs of the targeted cards (indices shift when other cards are removed). */
  refs: LiveIndexRef[];
  /** Per-lane stoppers (poll stop + backend job cancel). */
  cancels: Set<() => void>;
}
const _invocations = new Set<GenerationInvocation>();
/** Live refs of every card targeted by an in-flight invocation; remapped with the cards. */
const soundCardRefs = createLiveIndexRegistry();

function stopInvocation(invocation: GenerationInvocation): void {
  _invocations.delete(invocation);
  try { invocation.controller.abort(); } catch {}
  invocation.cancels.forEach((cancel) => cancel());
  invocation.cancels.clear();
}

/**
 * Follow sound cards across insertion / removal / reorder: remap live refs and
 * the per-card generation UI state, and stop invocations left without a card.
 */
function remapGenerationIndices(mapIndex: IndexMapper): void {
  soundCardRefs.remap(mapIndex);
  const s = useSoundscapeStore.getState();
  useSoundscapeStore.setState(
    {
      soundGenCardProgress: remapIndexKeyedRecord(s.soundGenCardProgress, mapIndex),
      soundGenCardStatus: remapIndexKeyedRecord(s.soundGenCardStatus, mapIndex),
      activeGenerationCardIndices: s.activeGenerationCardIndices
        .map(mapIndex)
        .filter((i): i is number => i !== null),
    },
    false,
    'soundscape/remapGenerationIndices',
  );
  for (const invocation of [..._invocations]) {
    if (invocation.refs.every((ref) => ref.current === null)) stopInvocation(invocation);
  }
}

/** Per-card generation UI state with `indices` dropped (an invocation clearing only its own cards). */
function withoutGenerationCards(
  s: Pick<SoundscapeStoreState, 'activeGenerationCardIndices' | 'soundGenCardStatus' | 'soundGenCardProgress'>,
  indices: number[],
  keepProgress = false,
) {
  const drop = new Set(indices);
  const omit = <V,>(record: Record<number, V>) =>
    Object.fromEntries(Object.entries(record).filter(([k]) => !drop.has(Number(k)))) as Record<number, V>;
  return {
    activeGenerationCardIndices: s.activeGenerationCardIndices.filter((i) => !drop.has(i)),
    soundGenCardStatus: omit(s.soundGenCardStatus),
    ...(keepProgress ? {} : { soundGenCardProgress: omit(s.soundGenCardProgress) }),
  };
}

let _activeCount = 0;              // concurrent generation invocations in flight
let _targetGlobal = false;         // any active invocation is a "generate all"
const _targetIndices = new Set<number>();

// Latest orchestrate-agent status string, so the generation poll can combine it
// into the progress line ("Generating … · Orchestrating …"). Cleared per invocation.
let _orchestrateProgressStatus: string | null = null;

/**
 * Duration to request from ElevenLabs for a config.
 *
 * Only LLM-derived (scenario/foley) sounds carry a meaningful target length:
 * background beds and short (<4 s) events omit it so the model picks the
 * optimal length, and manual prompts never send one either — they have no
 * authored length, just the global default.
 */
function elevenLabsDurationSeconds(
  config: SoundGenerationConfig,
  isBackground: boolean,
): number | undefined {
  if (isBackground) return undefined;
  const isLlmDerived = !!config.scenarioSource || !!config.orchestrateMeta;
  if (!isLlmDerived) return undefined;
  return config.duration >= ELEVENLABS_MIN_PROMPT_DURATION ? config.duration : undefined;
}

// Per-type config-validation error shown inline on the sound card (mirrors the
// "Assign materials first" card-error pattern — not a toast). Also used as the
// disabled-reason on the per-card Generate button.
export function configValidationError(config: SoundGenerationConfig): string {
  switch (config.type) {
    case 'upload':
    case 'sample-audio':
      return 'Upload an audio file.';
    case 'library':
      return 'Select a library sound.';
    case 'catalog':
      return 'Select a catalog sound.';
    case 'text-to-speech':
      return 'Enter a text prompt.';
    case 'text-to-audio':
    default:
      return 'Enter a sound prompt.';
  }
}

function syncSoundGenActivity(): void {
  useSoundscapeStore.setState(
    {
      isSoundGenerating: _activeCount > 0,
      soundGenTargetIndices: _targetGlobal
        ? null
        : _targetIndices.size > 0
          ? [..._targetIndices]
          : null,
    },
    false,
    'soundscape/activitySync',
  );
}

/** Register an active generation invocation (affects `isSoundGenerating` only). */
export function beginSoundGeneration(): void {
  _activeCount += 1;
  syncSoundGenActivity();
}

/** Unregister a generation invocation. `isSoundGenerating` stays true while any remain. */
export function endSoundGeneration(): void {
  _activeCount = Math.max(0, _activeCount - 1);
  syncSoundGenActivity();
}

/** Track which cards an active invocation targets (undefined = generate all). */
export function trackGenerationTargets(targetIndices?: number[]): void {
  if (targetIndices === undefined) {
    _targetGlobal = true;
  } else {
    targetIndices.forEach((i) => _targetIndices.add(i));
  }
  syncSoundGenActivity();
}

/** Untrack an invocation's targeted cards (paired with trackGenerationTargets). */
export function untrackGenerationTargets(targetIndices?: number[]): void {
  if (targetIndices === undefined) {
    _targetGlobal = false;
  } else {
    targetIndices.forEach((i) => _targetIndices.delete(i));
  }
  syncSoundGenActivity();
}

/** Current card indices of the given `config_id`s (unknown ids are skipped). */
function cardIndicesForConfigIds(configIds: string[]): number[] {
  const wanted = new Set(configIds);
  const indices: number[] = [];
  useSoundscapeStore.getState().soundConfigs.forEach((c, i) => {
    if (c.config_id && wanted.has(c.config_id)) indices.push(i);
  });
  return indices;
}

/**
 * Show the cards of a recovered job (one this tab did not submit — after a
 * refresh, or another member's job in a shared workspace) as generating.
 * Keyed by `config_id` because card indices shift between save and reload.
 */
export function markRecoveredGenerationCards(configIds: string[]): void {
  const indices = cardIndicesForConfigIds(configIds);
  if (indices.length === 0) return;
  useSoundscapeStore.setState(
    (s) => ({
      activeGenerationCardIndices: [...new Set([...s.activeGenerationCardIndices, ...indices])],
      soundGenCardProgress: {
        ...s.soundGenCardProgress,
        ...Object.fromEntries(indices.map((i) => [i, s.soundGenCardProgress[i] ?? 0])),
      },
      soundGenCardStatus: {
        ...s.soundGenCardStatus,
        ...Object.fromEntries(indices.map((i) => [i, s.soundGenCardStatus[i] ?? 'Pending…'])),
      },
    }),
    false,
    'soundscape/markRecoveredCards',
  );
}

/** Per-card progress of a recovered job (every card of the job shares the job's progress). */
export function updateRecoveredGenerationCards(configIds: string[], progress: number, status: string): void {
  const indices = cardIndicesForConfigIds(configIds);
  if (indices.length === 0) return;
  useSoundscapeStore.setState(
    (s) => ({
      soundGenCardProgress: { ...s.soundGenCardProgress, ...Object.fromEntries(indices.map((i) => [i, progress])) },
      soundGenCardStatus: { ...s.soundGenCardStatus, ...Object.fromEntries(indices.map((i) => [i, status])) },
    }),
    false,
    'soundscape/updateRecoveredCards',
  );
}

/** Clear the generating state set by `markRecoveredGenerationCards`. */
export function clearRecoveredGenerationCards(configIds: string[]): void {
  const indices = cardIndicesForConfigIds(configIds);
  if (indices.length === 0) return;
  useSoundscapeStore.setState(
    (s) => withoutGenerationCards(s, indices),
    false,
    'soundscape/clearRecoveredCards',
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function calibrateBlobUrl(
  blobOrUrl: Blob | string,
  dbfs: number,
  applyDenoising: boolean,
  trimSilence: boolean = false,
): Promise<{ url: string; noise_trim?: [number, number] | null }> {
  const blob =
    typeof blobOrUrl === 'string' ? await fetch(blobOrUrl).then((r) => r.blob()) : blobOrUrl;
  const { url, noise_trim } = await apiService.calibrateAudio(blob, dbfs, applyDenoising, trimSilence);
  return { url, noise_trim };
}

function reindexSoundsMulti(sounds: any[], removedIndices: number[]): any[] {
  const removed = new Set(removedIndices);
  return sounds
    .filter((s: any) => !removed.has(s.prompt_index))
    .map((s: any) => {
      const shift = removedIndices.filter((r) => r < s.prompt_index).length;
      return shift > 0 ? { ...s, prompt_index: s.prompt_index - shift } : s;
    });
}

/**
 * Does a sound event belong to a card? Entity linkage, position and selection
 * are card-level (all variants share them), and a sound's `prompt_index` is
 * either the config index or an encoded `cardIndex * 10000 + lineIdx` (speech).
 * Never compare prompt_index for equality — always go through this.
 */
export function promptMatchesCard(
  promptIndex: number | undefined | null,
  cardIndex: number,
): boolean {
  if (promptIndex === undefined || promptIndex === null) return false;
  if (promptIndex === cardIndex) return true;
  return promptIndex >= 10000 && Math.floor(promptIndex / 10000) === cardIndex;
}

// Apply backend-detected noise trim regions ([start, end] fractions) to the
// non-destructive wavesurfer trim handles. The backend computes these with the
// exact same librosa onset detection used for denoising; we just surface them.
function applyTrimRegions(events: any[]): void {
  for (const e of events) {
    const nt = e?.noise_trim;
    if (!e?.id || !Array.isArray(nt) || nt.length !== 2) continue;
    const [start, end] = nt;
    if (typeof start !== 'number' || typeof end !== 'number') continue;
    if (start < 0 || end > 1 || end <= start) continue;
    useAudioControlsStore.getState().setSoundTrim(e.id, { start, end });
  }
}

// ─── Orchestrate (parallel with generation) ───────────────────────────────────

/** Combine the generation poll status with any active orchestrate-agent status. */
function combinedProgress(status: string): string {
  return _orchestrateProgressStatus ? `${status} · ${_orchestrateProgressStatus}` : status;
}

/** One orchestrate playlist entry (timeline dynamics + levels), keyed by entry id. */
interface OrchestrateDynamics {
  trigger: { type: string; expression: string[]; delay: number[] };
  variants: number[];
  spl: string;
}

function playlistToDynamics(playlist: unknown[]): Map<string, OrchestrateDynamics> {
  const entryById = new Map<string, OrchestrateDynamics>();
  for (const raw of playlist) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { id?: string } & OrchestrateDynamics;
    if (!entry.id) continue;
    entryById.set(entry.id, {
      trigger: entry.trigger,
      variants: entry.variants,
      spl: entry.spl,
    });
  }
  return entryById;
}

/**
 * Build the foley/speech payload fed to the orchestrate agent from the current
 * (user-edited) scenario-source cards. Single source of truth for both running
 * the agent and detecting whether its inputs changed.
 */
/** Measured per-copy clip lengths (seconds) for one orchestrate entry. */
export interface EntryTimings {
  /** Length in seconds per generated copy (0-based copy_index). */
  copyDurations: number[];
  /** Speech only: the spoken line + its measured duration, per copy. */
  lines?: { text: string; durationSec: number }[];
}

/**
 * Scenario-scoped map key. Entry ids are NOT globally unique — the same
 * `entryId` (e.g. `footsteps_concrete_1`) exists in several scenarios, so every
 * orchestrate map must be keyed by `scenarioId::entryId` to prevent one
 * scenario's dynamics from overwriting another's.
 */
function scopedEntryKey(scenarioId: string | undefined, entryId: string): string {
  return `${scenarioId ?? ''}::${entryId}`;
}

/**
 * Build `scenarioId::entryId → measured durations` from the generated sounds +
 * decoded buffers. Must be keyed by the full `soundConfigs` array index
 * (generated sounds carry `prompt_index` = config index).
 */
/** Trim (fractions 0-1) applied to a copy's measured duration. Matches the bake. */
function effectiveCopyDuration(
  rawDur: number,
  trim: { start: number; end: number } | undefined,
): number {
  if (!trim || rawDur <= 0) return rawDur;
  return Math.max(0, rawDur * ((trim.end ?? 1) - (trim.start ?? 0)));
}

export function buildEntryTimings(
  configs: SoundGenerationConfig[],
  generatedSounds: any[],
  bufferDurations: Record<string, number>,
  soundTrims?: Record<string, { start: number; end: number }>,
): Map<string, EntryTimings> {
  const map = new Map<string, EntryTimings>();
  configs.forEach((config, index) => {
    const src = config.scenarioSource;
    if (!src) return;
    const gen = generatedSounds
      .filter((s) => s.prompt_index === index)
      .sort((a, b) => (a.copy_index ?? 0) - (b.copy_index ?? 0));
    // Trim is keyed by the primary (lowest copy) sound id, like the bake.
    const trim = gen[0]?.id ? soundTrims?.[gen[0].id] : undefined;
    const copyDurations = gen.map((s) =>
      effectiveCopyDuration(bufferDurations[s.id] ?? s.duration ?? 0, trim),
    );
    const lines = src.isSpeech
      ? (config.orchestrateMeta?.speechLines ?? src.speechLines ?? [src.script]).map((text, i) => ({
          text,
          durationSec: copyDurations[i] ?? 0,
        }))
      : undefined;
    map.set(scopedEntryKey(src.scenarioId, src.entryId), { copyDurations, lines });
  });
  return map;
}

/** Poll until every given sound has a decoded buffer duration (or timeout). */
async function waitForSoundBuffers(soundIds: string[], timeoutMs: number): Promise<boolean> {
  if (soundIds.length === 0) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const durations = useAudioControlsStore.getState().soundBufferDurations;
    if (soundIds.every((id) => durations[id] != null)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** Pad/truncate an authored timestamp hint to the entry's current iteration count. */
function alignTimestampHint(ts: string[] | undefined, count: number): string[] {
  const out = (ts ?? []).slice(0, count);
  while (out.length < count) out.push('00:00');
  return out;
}

/** Current iteration count for an entry — reflects edits to the sound section. */
function currentIterationCount(config: SoundGenerationConfig): number {
  const src = config.scenarioSource!;
  if (src.isSpeech) {
    const lines = config.orchestrateMeta?.speechLines ?? src.speechLines ?? [];
    return Math.max(1, lines.length || (src.script ? 1 : 0) || src.timestamps.length || 1);
  }
  return Math.max(
    1,
    config.orchestrateMeta?.trigger?.expression?.length
      ?? src.timestamps.length
      ?? config.seed_copies
      ?? 1,
  );
}

function buildOrchestrateInputs(
  configs: SoundGenerationConfig[],
  timings?: Map<string, EntryTimings>,
): { foleySounds: any[]; speeches: any[] } {
  const foleySounds: any[] = [];
  const speeches: any[] = [];
  configs.forEach((config) => {
    const src = config.scenarioSource;
    if (!src) return;
    const timing = timings?.get(scopedEntryKey(src.scenarioId, src.entryId));
    const meta = config.orchestrateMeta;
    const count = currentIterationCount(config);
    const timestamps = alignTimestampHint(meta?.timestamps ?? src.timestamps, count);
    // Re-orchestration context: the schedule currently in place for this entry.
    const currentSchedule = {
      currentTrigger: meta?.trigger,
      currentTimestamps: meta?.timestamps,
      currentVariants: meta?.variants,
    };
    if (src.isSpeech) {
      // Current speech lines are authoritative (add/delete/edit in the sound section).
      const lines = (meta?.speechLines ?? src.speechLines ?? (src.script ? [src.script] : [])).slice(0, count);
      speeches.push({
        id: src.entryId,
        timestamps,
        character: src.character,
        script: lines.join('; '),
        position: src.position,
        copyCount: Math.max(1, lines.length),
        copyDurations: timing?.copyDurations,
        lines: timing?.lines,
        ...currentSchedule,
      });
    } else {
      foleySounds.push({
        id: src.entryId,
        soundName: src.soundName,
        description: src.description,
        category: src.category,
        duration: src.duration,
        timestamps,
        objectsInvolved: src.objectsInvolved,
        position: src.position,
        copyCount: Math.max(1, config.seed_copies ?? src.copyCount ?? 1),
        copyDurations: timing?.copyDurations,
        ...currentSchedule,
      });
    }
  });
  return { foleySounds, speeches };
}

/**
 * Stable signature of the orchestrate-agent inputs plus the per-entry variant
 * count. Compared against the baseline captured after the last orchestration to
 * decide whether the "Re-orchestrate timeline" button should be offered — any
 * change (edited speech lines, copy counts, timestamps, objects, or a deleted
 * variant) flips it.
 */
export function orchestrateInputsSignature(configs: SoundGenerationConfig[]): string {
  const relevant = configs.filter((c) => c.scenarioSource);
  const inputs = buildOrchestrateInputs(relevant);
  const variantSummary = relevant.map((c) => ({
    entryId: c.scenarioSource!.entryId,
    variantCount: c.orchestrateMeta?.variants?.length ?? c.scenarioSource!.copyCount,
  }));
  return JSON.stringify({ inputs, variantSummary });
}

/**
 * Run the orchestrate agent for each unique scenario source, rebuilding the
 * foley + speech input from the user's current (edited) cards. Runs fully in
 * parallel with sound generation — the returned maps are applied at the sync
 * point once both settle.
 */
async function runOrchestrationForSources(
  scenarioGroups: Map<string, SoundGenerationConfig[]>,
  signal: AbortSignal,
  onProgress?: (status: string) => void,
  timings?: Map<string, EntryTimings>,
  mode: 'initial' | 'reorchestrate' = 'initial',
  onThinking?: (thinking: string) => void,
): Promise<{ entryById: Map<string, OrchestrateDynamics>; orchestrateIdByScenario: Map<string, string> }> {
  const entryById = new Map<string, OrchestrateDynamics>();
  const orchestrateIdByScenario = new Map<string, string>();

  for (const [scenarioId, configs] of scenarioGroups) {
    const { foleySounds, speeches } = buildOrchestrateInputs(configs, timings);

    try {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      onProgress?.('Orchestrating timeline…');
      const { job_id } = await apiService.enqueueLlmJob('/api/orchestrate', {
        scenario_id: scenarioId,
        foley_data: { sounds: foleySounds },
        speech_data: { speeches },
        llm_model: DEFAULT_LLM_MODEL,
        mode,
      });
      recordInflightJob(job_id, 'llm', { kind: 'orchestrate', scenarioId });
      _activeOrchestrateJobIds.add(job_id);

      const controller = startPolling({
        fetchStatus: () => apiService.getJobStatus('llm', job_id),
        onStatus: (s) => {
          // `s.status` is the backend's already-condensed last sentence
          // (`_last_status_sentence(thought)`), exactly what every other agent
          // card shows. Replacing it each poll keeps the line from accumulating.
          if (typeof s.partial?.thinking === 'string') onThinking?.(s.partial.thinking);
          const items = Array.isArray(s.partial?.items) ? s.partial.items : [];
          if (items.length > 0) {
            onProgress?.(
              `Orchestrating timeline… ${items.length} sound${items.length === 1 ? '' : 's'}`,
            );
          } else {
            onProgress?.(s.status || 'Orchestrating timeline…');
          }
        },
      });
      orchestratePollRegistry.track(controller);

      const onAbort = () => {
        controller.stop();
        apiService.cancelJob(job_id).catch(() => {});
      };
      signal.addEventListener('abort', onAbort);
      try {
        const result = await controller.done;
        const playlist = Array.isArray(result?.playlist) ? result.playlist : [];
        for (const [id, dyn] of playlistToDynamics(playlist)) {
          entryById.set(scopedEntryKey(scenarioId, id), dyn);
        }
        orchestrateIdByScenario.set(scenarioId, (result?.orchestrate_id as string) ?? '');
      } finally {
        signal.removeEventListener('abort', onAbort);
        orchestratePollRegistry.release(controller);
        _activeOrchestrateJobIds.delete(job_id);
        removeInflightJob(job_id);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      // Orchestration is a best-effort enhancement — degrade to an un-orchestrated
      // (interval-mode) schedule rather than failing the whole generation.
      console.warn('[soundscapeStore] Orchestration failed, continuing without parametric schedule:', e);
    }
  }

  return { entryById, orchestrateIdByScenario };
}

export function applyRecoveredOrchestrateResult(result: unknown, scenarioId?: string): void {
  const payload = result as { playlist?: unknown[]; orchestrate_id?: string } | null;
  const playlist = Array.isArray(payload?.playlist) ? payload.playlist : [];
  const rawEntryById = playlistToDynamics(playlist);
  const entryById = new Map<string, OrchestrateDynamics>();
  for (const [id, dyn] of rawEntryById) entryById.set(scopedEntryKey(scenarioId, id), dyn);
  const orchestrateIdByScenario = new Map<string, string>();
  if (scenarioId && payload?.orchestrate_id) {
    orchestrateIdByScenario.set(scenarioId, payload.orchestrate_id);
  }
  if (entryById.size > 0) applyOrchestrateDynamics(entryById, orchestrateIdByScenario);
}

export function resumeOrchestrateJob(jobId: string, scenarioId?: string): void {
  _activeOrchestrateJobIds.add(jobId);
  const controller = startPolling({
    fetchStatus: () => apiService.getJobStatus('llm', jobId),
    onStatus: (s) => {
      _orchestrateProgressStatus = s.status || 'Orchestrating timeline…';
    },
  });
  orchestratePollRegistry.track(controller);
  void controller.done
    .then((result) => applyRecoveredOrchestrateResult(result, scenarioId))
    .catch(() => {
      /* cancelled / error */
    })
    .finally(() => {
      orchestratePollRegistry.release(controller);
      _activeOrchestrateJobIds.delete(jobId);
      removeInflightJob(jobId);
      _orchestrateProgressStatus = null;
    });
}

/**
 * Apply orchestrate dynamics (trigger/variants/SPL) to the scenario-source configs
 * and generated events. Called at the sync point once both orchestration and sound
 * generation have settled, so the parametric schedule (bakeOrchestrateSchedule) can
 * use the compiled timeline.
 */
function applyOrchestrateDynamics(
  entryById: Map<string, OrchestrateDynamics>,
  orchestrateIdByScenario: Map<string, string>,
): void {
  const state = useSoundscapeStore.getState();
  const splByIndex = new Map<number, number>();

  const nextConfigs = state.soundConfigs.map((c, index) => {
    const src = c.scenarioSource;
    if (!src) return c;
    const dynamics = entryById.get(scopedEntryKey(src.scenarioId, src.entryId));
    if (!dynamics) return c;
    const splMatch = dynamics.spl?.match(/(-?\d+(?:\.\d+)?)/);
    // Clamp to the valid dBFS range — the orchestrator is asked for negative dBFS
    // (−60..0) but can occasionally emit an out-of-range value; without clamping a
    // rogue positive value would drive the playback gain into its ceiling.
    const dbfsVal = splMatch
      ? Math.max(DBFS_MIN, Math.min(DBFS_MAX, parseFloat(splMatch[1])))
      : undefined;
    if (dbfsVal !== undefined) splByIndex.set(index, dbfsVal);
    // Preserve the user's CURRENT edits on re-orchestration — never fall back to
    // the frozen scenarioSource snapshot for fields the sound section can edit.
    const prevMeta = c.orchestrateMeta;
    const currentSpeechLines = prevMeta?.speechLines ?? src.speechLines;
    const currentTimestamps = prevMeta?.timestamps ?? src.timestamps;
    return {
      ...c,
      ...(dbfsVal !== undefined ? { dbfs: dbfsVal } : {}),
      orchestrateMeta: {
        orchestrateId: orchestrateIdByScenario.get(src.scenarioId) ?? '',
        entryId: src.entryId,
        trigger: dynamics.trigger,
        variants: dynamics.variants,
        allObjectIds: prevMeta?.allObjectIds?.length ? prevMeta.allObjectIds : src.objectsInvolved,
        isSpeech: src.isSpeech,
        voiceName: src.voiceName,
        speechLines: src.isSpeech ? currentSpeechLines : undefined,
        timestamps: currentTimestamps,
      },
    };
  });

  const withVolume = (events: any[] | null): any[] | null => {
    if (!events || splByIndex.size === 0) return events;
    return events.map((e) => {
      const spl = splByIndex.get(e.prompt_index);
      return spl !== undefined ? { ...e, volume_dbfs: spl } : e;
    });
  };

  useSoundscapeStore.setState({
    soundConfigs: nextConfigs,
    generatedSounds: withVolume(state.generatedSounds) ?? state.generatedSounds,
    soundscapeData: withVolume(state.soundscapeData),
  });
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
//
// History holds the cards, the generated events and the global generation
// settings. Snapshots keep REFERENCES to everything (uploaded AudioBuffers /
// blob URLs included) so an undo never strips a card's audio. A card's library
// search results and its error message are runtime: they never create a step
// and stay live across undo. Generation results are steps (a finished
// generation can be undone / redone); streamed results collapse into one step.

/** Per-card fields that are runtime, not edits. */
const SOUND_CONFIG_RUNTIME_KEYS = ['librarySearchState', 'error'] as const;

function soundConfigProjection(config: SoundGenerationConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of SOUND_CONFIG_RUNTIME_KEYS) delete out[key];
  return out;
}

export const soundscapePartialize = (state: SoundscapeStoreState) => ({
  soundConfigs: state.soundConfigs,
  generatedSounds: state.generatedSounds,
  soundscapeData: state.soundscapeData,
  globalDuration: state.globalDuration,
  globalSteps: state.globalSteps,
  globalNegativePrompt: state.globalNegativePrompt,
  applyDenoising: state.applyDenoising,
  trimSilence: state.trimSilence,
  applyNoiseReduction: state.applyNoiseReduction,
  audioModel: state.audioModel,
  llmModel: state.llmModel,
  ttsModel: state.ttsModel,
  orchestrateSoundsEnabled: state.orchestrateSoundsEnabled,
});

type SoundscapeSnapshot = ReturnType<typeof soundscapePartialize>;

const soundscapeEquality = (a: SoundscapeSnapshot, b: SoundscapeSnapshot): boolean => {
  const { soundConfigs: ca, ...restA } = a;
  const { soundConfigs: cb, ...restB } = b;
  if (!undoEquality(restA, restB)) return false;
  if (ca === cb) return true;
  return ca.length === cb.length && ca.every((c, i) => undoEquality(soundConfigProjection(c), soundConfigProjection(cb[i])));
};

export const soundscapeUndo: RegisterTemporalStoreOptions<SoundscapeStoreState, SoundscapeSnapshot> = {
  partialize: soundscapePartialize,
  equality: soundscapeEquality,
  apply: (snapshot) => {
    const live = useSoundscapeStore.getState();
    const liveById = new Map<string, SoundGenerationConfig>();
    for (const c of live.soundConfigs) if (c.config_id) liveById.set(c.config_id, c);
    const soundConfigs = snapshot.soundConfigs.map((config) => {
      const liveConfig = config.config_id ? liveById.get(config.config_id) : undefined;
      if (liveConfig) {
        return { ...config, librarySearchState: liveConfig.librarySearchState, error: liveConfig.error };
      }
      return config.librarySearchState?.isSearching
        ? { ...config, librarySearchState: { ...config.librarySearchState, isSearching: false } }
        : config;
    });
    useSoundscapeStore.setState({
      ...snapshot,
      soundConfigs,
      activeSoundConfigTab: Math.min(live.activeSoundConfigTab, Math.max(0, soundConfigs.length - 1)),
    });
  },
};

// ─── State ────────────────────────────────────────────────────────────────────

export interface SoundscapeStoreState {
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  isSoundGenerating: boolean;
  soundGenTargetIndices: number[] | null;
  soundGenError: string | null;
  soundGenProgress: string;
  soundGenProgressValue: number;
  /** Granular backend status for the currently-generating sound card
   *  (e.g. "Generating sound 1/8 (prompt): step 15/25…"). Shown on the active
   *  card in place of the global sample-count message. */
  soundGenStatusText: string;
  /** Approximate per-card generation progress (card index → 0-100). Derived from
   *  each card's completed/expected samples across all concurrent generation lanes. */
  soundGenCardProgress: Record<number, number>;
  /** Card indices with a generation currently in flight (across all lanes). Drives
   *  the per-card "running" state; cards leave the set as their samples land. */
  activeGenerationCardIndices: number[];
  /** Per-card status label (card index → text). Initialized to "Pending…" for
   *  every targeted card, then updated by the owning lane as it starts/finishes
   *  each item — so concurrent cards each show their own status, not a shared one. */
  soundGenCardStatus: Record<number, string>;
  generatedSounds: any[];
  soundscapeData: any[] | null;
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  trimSilence: boolean;
  applyNoiseReduction: boolean;
  regeneratingIndices: number[];
  /** Card indices with an IN-PLACE variant regeneration in flight (audio swapped
   *  on the SAME sound event, keeping its id / DAW / entity / sphere links). */
  regeneratingVariantIndices: number[];
  audioModel: string;
  llmModel: string;
  ttsModel: string;
  /** When true, generating scenario-derived sounds also runs the orchestrate agent
   *  in parallel to compile the parametric timeline (trigger/variants/SPL). */
  orchestrateSoundsEnabled: boolean;
  /** Signature of the orchestrate-agent inputs captured after the last orchestration.
   *  The "Re-orchestrate timeline" button shows only when the current inputs differ. */
  orchestrateBaselineSignature: string | null;
  /** True while the "Re-orchestrate timeline" LLM run is in flight. */
  isReorchestrating: boolean;
  /** True while the orchestrate agent runs (after generation, or a re-orchestration). Not persisted. */
  isOrchestrating: boolean;
  /** Scenario ids whose post-generation orchestration is running (scenes generate concurrently). */
  orchestratingScenarioIds: string[];
  /** Full thinking text of the running orchestrate agent (live). Not persisted. */
  orchestrateThinking: string;

  handleAddConfig: (type?: CardType) => void;
  handleBatchAddConfigs: (count: number) => number;
  handleRemoveConfig: (index: number) => void;
  /** Remove multiple sound configs at once (cascade delete from a parent card). */
  handleRemoveConfigs: (indices: number[]) => void;
  handleUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  /** Restore a generated card's settings to those of its last generation (one undo step). */
  revertGenerationSettings: (index: number) => void;
  /**
   * Load the generation settings of one variant (by event id) into the card, so
   * "Change sound settings" shows — and Revert restores — that variant's inputs.
   * No-op for variants generated before per-variant snapshots existed.
   */
  applyVariantGenerationSettings: (index: number, variantId: string) => void;
  /**
   * Re-parent a sound card to a different usage card (sound section), keeping all
   * generated variants/events (keyed by prompt_index) intact and repointing the
   * cardFlow usage→sound linkage.
   */
  reassignSoundParent: (soundConfigIndex: number, targetParentUsageIndex: number) => void;
  handleTypeChange: (index: number, type: CardType) => Promise<void>;
  handleGlobalDurationChange: (duration: number) => void;
  handleGlobalStepsChange: (steps: number) => void;
  handleGenerate: () => Promise<void>;
  handleGenerateSingle: (targetIndex: number) => Promise<void>;
  handleGenerateFiltered: (targetIndices: number[], options?: Pick<GenerateSoundsOptions, 'audioModel'>) => Promise<GenerateSoundsOutcome>;
  /**
   * Generate the targeted configs. With `force`, already-generated targets are
   * regenerated too: their events are replaced (same deterministic ids, so
   * positions / entity / DAW links survive) and stale extra variants dropped.
   */
  handleGenerateInternal: (targetIndices?: number[], options?: GenerateSoundsOptions) => Promise<GenerateSoundsOutcome>;
  /** Regenerate ALL variants of an already-generated card from its (edited) settings. */
  handleRegenerateConfig: (targetIndex: number) => Promise<void>;
  handleRegenerateSingle: (targetIndex: number) => Promise<void>;
  /**
   * Regenerate the audio of ONE existing variant IN PLACE, keeping its sound
   * id, copy_index, position, entity links and DAW variant/timeline assignment
   * identical — only the underlying WAV (url/duration) is swapped. Optionally
   * regenerates from an edited prompt (`newPrompt`), which is also written back
   * onto the card config / its TTS speech line.
   */
  regenerateVariantInPlace: (targetIndex: number, variantIdx: number, newPrompt?: string) => Promise<void>;
  handleStopGeneration: () => void;
  /** Stop only the generations targeting any of these cards (other scenes keep running). */
  handleStopGenerationFor: (targetIndices: number[]) => void;
  handleReprocessSounds: (applyDenoising: boolean) => Promise<void>;
  setActiveSoundConfigTab: (tab: number) => void;
  setSoundConfigsFromPrompts: (prompts: any[]) => void;
  setSoundscapeData: (data: any[] | null) => void;
  setGlobalNegativePrompt: (val: string) => void;
  setApplyDenoising: (val: boolean) => void;
  setTrimSilence: (val: boolean) => void;
  setApplyNoiseReduction: (val: boolean) => void;
  setAudioModel: (model: string) => void;
  setLlmModel: (model: string) => void;
  setTtsModel: (model: string) => void;
  setOrchestrateSoundsEnabled: (val: boolean) => void;
  handleUploadAudio: (index: number, file: File) => Promise<void>;
  handleClearUploadedAudio: (index: number) => void;
  handleLibrarySearch: (index: number) => Promise<void>;
  handleLibrarySoundSelect: (index: number, sound: LibrarySearchResult) => void;
  handleCatalogSoundSelect: (index: number, sound: CatalogSoundSelection) => void;
  handleResetToDefaults: () => void;
  clearOrchestrateTrigger: (configIndex: number, iterationIndex: number) => void;
  handleResetSoundConfig: (index: number) => void;
  /** Reload the deterministic bundled sample into any sample-audio config that
   *  lost its (blob) clip — used after a soundscape restore / page refresh. */
  rehydrateSampleAudioConfigs: () => Promise<void>;
  handleReorderSoundConfigs: (from: number, to: number) => void;
  handleDuplicateConfig: (index: number) => void;
  /** Delete a single variant from a generated sound card (ML/TTS variants, and
   *  SED-extracted segment variants — the latter also removes the backend WAV). */
  handleDeleteVariant: (promptIndex: number, variantIdx: number) => void;
  /**
   * Re-run the orchestrate agent on the current edited scene, then apply its new
   * triggers/variants/SPL and re-bake the timeline. Used by the "Re-orchestrate
   * timeline" button. Falls back to a pure re-bake when no scenario sources exist.
   */
  reorchestrateTimeline: (scenarioId?: string) => Promise<void>;
  /** Ctrl+drag duplicate — deep-clones the config at `from` (and soundscape data) and inserts at `toInsertion`. */
  duplicateConfigAt: (from: number, toInsertion: number) => void;
  handleDetachSoundFromEntity: (index: number) => void;
  handleAttachSoundToEntity: (index: number, entity: any, append?: boolean) => void;
  updateSoundPosition: (soundId: string, position: [number, number, number]) => void;
  patchSoundEvent: (soundId: string, patch: Partial<SoundEvent>) => void;
  selectLinkedEntity: (soundId: string, entityIndex: number, position: [number, number, number]) => void;
  restoreSoundscape: (
    configs: SoundGenerationConfig[],
    events: any[],
    settings?: { duration?: number; steps?: number; negativePrompt?: string; audioModel?: string; llmModel?: string; ttsModel?: string; orchestrateSoundsEnabled?: boolean },
  ) => void;
  injectExtractedSEDSounds: (sounds: Array<{
    name: string;
    dbfs?: number;
    interval_seconds?: number;
    variants: Array<{ url: string; duration: number }>;
  }>, parentUsageOriginalIndex?: number) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSoundscapeStore = create<SoundscapeStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        soundConfigs: [],
        activeSoundConfigTab: 0,
        isSoundGenerating: false,
        soundGenError: null,
        soundGenProgress: '',
        soundGenProgressValue: 0,
        soundGenStatusText: '',
        soundGenCardProgress: {},
        activeGenerationCardIndices: [],
        soundGenCardStatus: {},
        generatedSounds: [],
        soundscapeData: null,
        globalDuration: DEFAULT_DURATION_SECONDS,
        globalSteps: DEFAULT_DIFFUSION_STEPS,
        globalNegativePrompt:
          'distorted, reverb, echo, background noise, hall, spaciousness',
        applyDenoising: false,
        trimSilence: false,
        applyNoiseReduction: true,
        regeneratingIndices: [],
        regeneratingVariantIndices: [],
        soundGenTargetIndices: null,
        llmModel: DEFAULT_LLM_MODEL,
        audioModel: DEFAULT_AUDIO_MODEL,
        ttsModel: DEFAULT_TTS_MODEL,
        orchestrateSoundsEnabled: false,
        orchestrateBaselineSignature: null,
        isReorchestrating: false,
        isOrchestrating: false,
        orchestratingScenarioIds: [],
        orchestrateThinking: '',

        handleAddConfig: (type = 'text-to-audio') => {
          const { globalDuration, globalSteps, soundConfigs } = get();
          const newConfig: SoundGenerationConfig = {
            config_id: newConfigId(),
            prompt: '',
            duration: globalDuration,
            guidance_scale: DEFAULT_GUIDANCE_SCALE,
            negative_prompt: '',
            seed_copies: DEFAULT_SEED_COPIES,
            steps: globalSteps,
            type,
            uploadedAudioBuffer: undefined,
            uploadedAudioInfo: undefined,
            uploadedAudioUrl: undefined,
            selectedLibrarySound: undefined,
            librarySearchState: undefined,
            selectedCatalogSound: undefined,
            display_name: undefined,
            entities: undefined,
            ...(type === 'text-to-speech' ? { voice_name: TTS_DEFAULT_VOICE } : {}),
          };
          set(
            { soundConfigs: [...soundConfigs, newConfig], activeSoundConfigTab: soundConfigs.length },
            false,
            'soundscape/addConfig',
          );
        },

        handleBatchAddConfigs: (count) => {
          const { soundConfigs, globalDuration, globalSteps } = get();
          const startIndex = soundConfigs.length;
          const newConfigs = Array.from({ length: count }, () => ({
            config_id: newConfigId(),
            prompt: '',
            duration: globalDuration,
            guidance_scale: DEFAULT_GUIDANCE_SCALE,
            negative_prompt: '',
            seed_copies: DEFAULT_SEED_COPIES,
            steps: globalSteps,
            type: 'text-to-audio' as CardType,
          }));
          set(
            { soundConfigs: [...soundConfigs, ...newConfigs] },
            false,
            'soundscape/batchAddConfigs',
          );
          return startIndex;
        },

        handleRemoveConfig: (index) => {
          get().handleRemoveConfigs([index]);
        },

        handleRemoveConfigs: (indices) => {
          if (indices.length === 0) return;
          // Card indices shift on removal — any stale preview reference must be cleared.
          useAudioControlsStore.getState().stopSoundcardPreview();
          const { soundConfigs, activeSoundConfigTab, soundscapeData, generatedSounds } = get();
          const removedSet = new Set(indices);

          // Orphaned generated sounds of the removed configs — their per-sound
          // state (timestamps / iterationLinks / durations / volumes) must be
          // pruned so it can never be baked back into the timeline.
          const removedSoundIds = [
            ...new Set(
              [...(soundscapeData ?? []), ...(generatedSounds ?? [])]
                .filter((s: any) => removedSet.has(s.prompt_index))
                .map((s: any) => s.id)
                .filter(Boolean),
            ),
          ] as string[];

          // Entry ids owned by removed configs — drop any parametric after()/
          // alignEnd() reference to them from the remaining cards' triggers so the
          // bake never resolves against a deleted entry.
          const removedEntryIds = new Set<string>(
            soundConfigs
              .filter((_, i) => removedSet.has(i))
              .flatMap((c) => [c.orchestrateMeta?.entryId, c.scenarioSource?.entryId])
              .filter((e): e is string => !!e),
          );
          const knownEntryIds = new Set<string>([
            ...soundConfigs.flatMap((c) => [c.orchestrateMeta?.entryId, c.scenarioSource?.entryId]),
            ...removedEntryIds,
          ].filter((e): e is string => !!e));
          const pruneTriggerRefs = (c: SoundGenerationConfig): SoundGenerationConfig => {
            const meta = c.orchestrateMeta;
            if (!meta || removedEntryIds.size === 0) return c;
            let changed = false;
            const expression = meta.trigger.expression.map((expr) => {
              const parsed = parseTriggerExpression(expr, knownEntryIds);
              if (parsed && parsed.refs.some((r) => removedEntryIds.has(r.entryId))) {
                changed = true;
                return '';
              }
              return expr;
            });
            if (!changed) return c;
            const delay = (meta.trigger.delay ?? []).map((d, i) => (expression[i] === '' ? 0 : d));
            return { ...c, orchestrateMeta: { ...meta, trigger: { ...meta.trigger, expression, delay } } };
          };

          const newConfigs = soundConfigs
            .filter((_, i) => !removedSet.has(i))
            .map(pruneTriggerRefs);
          const remainingIndices = soundConfigs.map((_, i) => i).filter((i) => !removedSet.has(i));
          let newTab = activeSoundConfigTab;
          if (removedSet.has(newTab)) {
            newTab = remainingIndices.length > 0 ? remainingIndices[remainingIndices.length - 1] : 0;
          } else {
            const below = indices.filter((i) => i < newTab).length;
            newTab = newTab - below;
          }
          // In-flight generations of other cards must follow the shift.
          remapGenerationIndices(createRemovalIndexMapper(indices));
          const newSoundscape = soundscapeData ? reindexSoundsMulti(soundscapeData, indices) : null;
          const newGenerated = reindexSoundsMulti(generatedSounds, indices);
          set(
            {
              soundConfigs: newConfigs,
              activeSoundConfigTab: newTab,
              soundscapeData: newSoundscape,
              generatedSounds: newGenerated,
            },
            false,
            'soundscape/removeConfigs',
          );

          // Re-sync the audio store and re-bake so the deleted track disappears
          // from the timeline immediately (and no stale iteration survives).
          const audioStore = useAudioControlsStore.getState();
          audioStore.syncSoundConfigs(newConfigs);
          audioStore.syncGeneratedSounds(newGenerated);
          audioStore.pruneSounds(removedSoundIds);
          if (newConfigs.some((c) => c.orchestrateMeta)) {
            audioStore.setOrchestrateIterationLinks(newConfigs);
            audioStore.bakeOrchestrateSchedule();
          }
        },

        handleReorderSoundConfigs: (from, to) => {
          const { soundConfigs, activeSoundConfigTab } = get();
          const newConfigs = [...soundConfigs];
          const [removed] = newConfigs.splice(from, 1);
          newConfigs.splice(to, 0, removed);
          let newTab = activeSoundConfigTab;
          if (newTab === from) newTab = to;
          else if (from < to && newTab > from && newTab <= to) newTab--;
          else if (from > to && newTab >= to && newTab < from) newTab++;
          remapGenerationIndices(createMoveIndexMapper(from, to));
          set(
            { soundConfigs: newConfigs, activeSoundConfigTab: newTab },
            false,
            'soundscape/reorderConfigs',
          );
        },

        handleUpdateConfig: (index, field, value) => {
          const { soundConfigs, soundscapeData, generatedSounds } = get();
          const updated = soundConfigs.map((c, i) =>
            i === index ? { ...c, [field]: value } : c,
          );
          // Sync display_name changes into soundscapeData / generatedSounds
          if (field === 'display_name') {
            const syncDisplayName = (sounds: any[]) =>
              sounds.map((s) =>
                s.prompt_index === index && value ? { ...s, display_name: value } : s,
              );
            set(
              {
                soundConfigs: updated,
                soundscapeData: soundscapeData ? syncDisplayName(soundscapeData) : null,
                generatedSounds: syncDisplayName(generatedSounds),
              },
              false,
              'soundscape/updateConfig',
            );
          } else {
            set({ soundConfigs: updated }, false, 'soundscape/updateConfig');
          }
        },

        revertGenerationSettings: (index) => {
          const config = get().soundConfigs[index];
          const patch = config ? getGenerationRevertPatch(config) : null;
          if (!patch) return;
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index ? ({ ...c, ...patch } as SoundGenerationConfig) : c,
              ),
            }),
            false,
            'soundscape/revertGenerationSettings',
          );
        },

        applyVariantGenerationSettings: (index, variantId) => {
          const { soundConfigs, generatedSounds, soundscapeData } = get();
          const config = soundConfigs[index];
          const variant = [...(generatedSounds || []), ...(soundscapeData || [])]
            .find((s) => s.id === variantId);
          const patch = config ? getVariantSettingsPatch(config, variant?.generated_signature) : null;
          if (!patch) return;
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index ? ({ ...c, ...patch } as SoundGenerationConfig) : c,
              ),
            }),
            false,
            'soundscape/applyVariantGenerationSettings',
          );
        },

        reassignSoundParent: (soundConfigIndex, targetParentUsageIndex) => {
          const { soundConfigs } = get();
          const config = soundConfigs[soundConfigIndex];
          if (!config) return;
          if (config.parentUsageOriginalIndex === targetParentUsageIndex) return;

          // 1. Repoint the config's section membership. Generated events (variants,
          //    positions, entity/timeline links) are keyed by prompt_index and move
          //    with the config untouched. Recorded via `set` inside the temporal
          //    store so the move is undoable.
          const updated = soundConfigs.map((c, i) =>
            i === soundConfigIndex
              ? { ...c, parentUsageOriginalIndex: targetParentUsageIndex }
              : c,
          );
          set({ soundConfigs: updated }, false, 'soundscape/reassignParent');

          // 2. Keep the cardFlow usage→sound linkage in sync (used for ctrl+drag
          //    copy + persisted card_flow state; the serializer also rebuilds it
          //    from parentUsageOriginalIndex on load, so this is consistency only).
          const flow = useCardFlowStore.getState();
          const newMap = new Map<number, number[]>();
          flow.usageToSoundMap.forEach((indices, usageIdx) => {
            const next = indices.filter((i) => i !== soundConfigIndex);
            if (next.length > 0) newMap.set(usageIdx, next);
          });
          const targetList = newMap.get(targetParentUsageIndex) ?? [];
          newMap.set(
            targetParentUsageIndex,
            targetList.includes(soundConfigIndex)
              ? targetList
              : [...targetList, soundConfigIndex],
          );
          useCardFlowStore.setState({
            usageToSoundMap: newMap,
            usageAdvanced: new Set([...flow.usageAdvanced, targetParentUsageIndex]),
          });
        },

        handleTypeChange: async (index, type) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          let updated: SoundGenerationConfig;

          if (
            (config.type === 'upload' || config.type === 'sample-audio') &&
            type !== 'upload' &&
            type !== 'sample-audio' &&
            config.uploadedAudioUrl
          ) {
            revokeAudioUrl(config.uploadedAudioUrl);
            updated = {
              ...config,
              type,
              uploadedAudioBuffer: undefined,
              uploadedAudioInfo: undefined,
              uploadedAudioUrl: undefined,
              display_name: undefined,
            };
          } else if (type === 'upload' || type === 'sample-audio') {
            updated = { ...config, type, display_name: undefined };
          } else {
            updated = { ...config, type };
          }

          const newConfigs = soundConfigs.map((c, i) => (i === index ? updated : c));
          set({ soundConfigs: newConfigs }, false, 'soundscape/typeChange');

          if (type === 'sample-audio') {
            try {
              const sampleFile = await apiService.loadSampleAudio();
              const result = await loadAudioFile(sampleFile);
              set(
                (s) => ({
                  soundConfigs: s.soundConfigs.map((c, i) =>
                    i === index
                      ? {
                          ...c,
                          uploadedAudioBuffer: result.audioBuffer,
                          uploadedAudioInfo: result.audioInfo,
                          uploadedAudioUrl: result.audioUrl,
                        }
                      : c,
                  ),
                }),
                false,
                'soundscape/sampleLoaded',
              );
            } catch (error) {
              const msg = error instanceof Error ? error.message : 'Failed to load sample audio';
              set(
                { soundGenError: msg },
                false,
                'soundscape/sampleError',
              );
              notifySectionError(msg);
            }
          }
        },

        handleGlobalDurationChange: (duration) => {
          const { soundConfigs } = get();
          set(
            {
              globalDuration: duration,
              soundConfigs: soundConfigs.map((c) => ({ ...c, duration })),
            },
            false,
            'soundscape/globalDuration',
          );
        },

        handleGlobalStepsChange: (steps) => {
          const { soundConfigs } = get();
          set(
            {
              globalSteps: steps,
              soundConfigs: soundConfigs.map((c) => ({ ...c, steps })),
            },
            false,
            'soundscape/globalSteps',
          );
        },

        handleGenerateSingle: async (targetIndex) => {
          await get().handleGenerateInternal([targetIndex]);
        },

        handleGenerateFiltered: (targetIndices, options) =>
          get().handleGenerateInternal(targetIndices, { audioModel: options?.audioModel }),

        handleGenerate: async () => {
          await get().handleGenerateInternal();
        },

        handleRegenerateConfig: async (targetIndex) => {
          await get().handleGenerateInternal([targetIndex], { force: true });
        },

        handleGenerateInternal: async (targetIndices, options) => {
          const {
            soundConfigs,
            soundscapeData,
            globalNegativePrompt,
            applyDenoising,
            trimSilence,
            applyNoiseReduction,
          } = get();
          // Per-invocation model: concurrent scenes may each use a different one.
          const audioModel = options?.audioModel ?? get().audioModel;
          const { geometryBounds } = useFileUploadStore.getState();

          // Identify already-generated config indices
          const alreadyGenerated = new Set<number>();
          if (soundscapeData) {
            soundscapeData.forEach((s: any) => {
              if (s.prompt_index !== undefined) {
                alreadyGenerated.add(s.prompt_index);
                // Speech lines encode card_idx * 10000 + line_idx — also mark the card as done.
                if (s.prompt_index >= 10000) {
                  alreadyGenerated.add(Math.floor(s.prompt_index / 10000));
                }
              }
            });
          }
          // Forced regeneration: targeted cards are generated again even though
          // they already have events (replaced at merge time below).
          const forcedIndices = new Set(options?.force ? targetIndices ?? [] : []);
          forcedIndices.forEach((i) => alreadyGenerated.delete(i));

          const withIndices = soundConfigs
            .map((config, idx) => ({ config, originalIndex: idx }))
            .filter(({ originalIndex }) => targetIndices === undefined || targetIndices.includes(originalIndex));

          const uploadedConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              (config.type === 'upload' || config.type === 'sample-audio') &&
              config.uploadedAudioUrl,
          );

          const libraryConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              config.type === 'library' &&
              config.selectedLibrarySound,
          );

          const catalogConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              config.type === 'catalog' &&
              config.selectedCatalogSound,
          );

          const elevenLabsConfigs2 = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              (config.type === 'text-to-audio' || !config.type) &&
              !config.uploadedAudioUrl &&
              config.prompt.trim() !== '',
          );

          const generationConfigs =
            audioModel !== AUDIO_MODEL_ELEVENLABS ? elevenLabsConfigs2 : [];
          const elevenLabsConfigs =
            audioModel === AUDIO_MODEL_ELEVENLABS ? elevenLabsConfigs2 : [];

          const ttsConfigs = withIndices.filter(
            ({ config, originalIndex }) =>
              !alreadyGenerated.has(originalIndex) &&
              config.type === 'text-to-speech' &&
              config.prompt.trim() !== '',
          );

          console.log('[handleGenerateInternal] targetIndices:', targetIndices,
            'withIndices.length:', withIndices.length,
            'ttsConfigs.length:', ttsConfigs.length,
            'generationConfigs.length:', generationConfigs.length,
            'alreadyGenerated:', [...alreadyGenerated],
            'soundscapeData exists:', !!soundscapeData);

          const total =
            generationConfigs.length +
            uploadedConfigs.length +
            libraryConfigs.length +
            catalogConfigs.length +
            elevenLabsConfigs.length +
            ttsConfigs.length;

          // ── Per-card sample accounting across ALL sound kinds ────────────────
          // The denominator is the number of generated AUDIO SAMPLES (variants /
          // speech lines / 1 for single-clip cards). Generation lanes run
          // concurrently, so progress is derived from per-card `done`/`expected`
          // counters rather than a single sequential cursor.
          const expectedSamples: Record<number, number> = {};
          const doneSamples: Record<number, number> = {};
          const registerExpected = (index: number, count: number) => {
            expectedSamples[index] = (expectedSamples[index] ?? 0) + Math.max(1, count);
          };
          generationConfigs.forEach(({ config, originalIndex }) =>
            registerExpected(originalIndex, config.seed_copies ?? 1),
          );
          ttsConfigs.forEach(({ config, originalIndex }) => {
            const lines = (config.orchestrateMeta?.speechLines
              ?? config.scenarioSource?.speechLines) as string[] | undefined;
            registerExpected(
              originalIndex,
              lines && lines.length > 0 ? lines.length : (config.seed_copies ?? 1),
            );
          });
          [...uploadedConfigs, ...libraryConfigs, ...catalogConfigs]
            .forEach(({ originalIndex }) => registerExpected(originalIndex, 1));
          elevenLabsConfigs.forEach(({ config, originalIndex }) =>
            registerExpected(originalIndex, config.seed_copies ?? 1),
          );

          // Every targeted card is followed by a live ref: another scene's cards may be
          // removed while this invocation runs. Events are built with the start index
          // (stable ids) and relocated to the live index when merged.
          const refByIndex = new Map<number, LiveIndexRef>(
            withIndices.map(({ originalIndex }) => [originalIndex, soundCardRefs.track(originalIndex)]),
          );
          const releaseRefs = () => refByIndex.forEach((ref) => soundCardRefs.release(ref));
          const live = (index: number): number | null => {
            const ref = refByIndex.get(index);
            return ref ? ref.current : index;
          };
          const liveIndices = (indices: Iterable<number>): number[] =>
            [...indices].map(live).filter((i): i is number => i !== null);
          const relocate = (events: any[]): any[] =>
            events.flatMap((e) => {
              if (typeof e?.prompt_index !== 'number') return [e];
              const liveIndex = live(e.prompt_index);
              if (liveIndex === null) return [];
              return liveIndex === e.prompt_index ? [e] : [{ ...e, prompt_index: liveIndex }];
            });

          const totalSamples = Object.values(expectedSamples).reduce((a, b) => a + b, 0);
          const doneTotal = () =>
            Object.values(doneSamples).reduce((a, b) => a + b, 0);
          const computeProgressValue = () =>
            totalSamples > 0
              ? Math.min(100, Math.round((Math.min(doneTotal(), totalSamples) / totalSamples) * 100))
              : 0;

          /** Advance a card's completed samples; republish aggregate + per-card progress. */
          const bumpSamples = (index: number, n: number, statusText = '') => {
            const cap = expectedSamples[index];
            if (n <= 0 || cap === undefined) return;
            doneSamples[index] = Math.min(cap, (doneSamples[index] ?? 0) + n);
            const cardPct = Math.round((doneSamples[index] / cap) * 100);
            const complete = doneSamples[index] >= cap;
            const liveIndex = live(index);
            set(
              (s) => ({
                soundGenProgressValue: computeProgressValue(),
                soundGenStatusText: statusText,
                ...(liveIndex === null
                  ? {}
                  : {
                      soundGenCardProgress: { ...s.soundGenCardProgress, [liveIndex]: cardPct },
                      ...(complete
                        ? { activeGenerationCardIndices: s.activeGenerationCardIndices.filter((i) => i !== liveIndex) }
                        : {}),
                    }),
              }),
              false,
              'soundscape/generateProgress',
            );
          };

          /** Set a single card's status label (no-op when unchanged). */
          const setCardStatus = (index: number, status: string) => {
            const liveIndex = live(index);
            if (liveIndex === null || get().soundGenCardStatus[liveIndex] === status) return;
            set(
              (s) => ({ soundGenCardStatus: { ...s.soundGenCardStatus, [liveIndex]: status } }),
              false,
              'soundscape/generateProgress',
            );
          };

          /** Update the aggregate progress line (numerator/denominator + stage label). */
          const setProgressLabel = (label: string, statusText = '') => {
            const clamped = Math.min(doneTotal(), totalSamples);
            set(
              {
                soundGenProgress: `${clamped}/${totalSamples} ${label}`,
                soundGenProgressValue: computeProgressValue(),
                soundGenStatusText: statusText,
              },
              false,
              'soundscape/generateProgress',
            );
          };

          /** Merge freshly-completed events into the live list (synchronous read-modify-write). */
          const mergePartialEvents = (rawEvents: any[]) => {
            const events = relocate(rawEvents);
            if (events.length === 0) return;
            const { generatedSounds: current } = get();
            const newIds = new Set(events.map((e: any) => e.id));
            const merged = [
              ...(current || []).filter((e: any) => !newIds.has(e.id)),
              ...events,
            ];
            set({ generatedSounds: merged }, false, 'soundscape/partialSound');
            applyTrimRegions(events);
          };

          const laneErrors: string[] = [];
          const recordLaneError = (lane: string, err: unknown) => {
            if (err instanceof Error && (err.name === 'AbortError' || err.message === 'AbortError')) return;
            const message = err instanceof Error ? err.message : String(err);
            laneErrors.push(`${lane}: ${message}`);
          };

          if (total === 0) {
            // No targeted config is ready — surface a per-card config error inline
            // (same pattern as "Assign materials first" on simulation cards).
            const invalidIndices = new Set(
              withIndices
                .filter(({ originalIndex }) => !alreadyGenerated.has(originalIndex))
                .map(({ originalIndex }) => originalIndex),
            );
            set(
              (s) => ({
                soundGenError: null,
                soundConfigs: s.soundConfigs.map((c, i) =>
                  invalidIndices.has(i) ? { ...c, error: configValidationError(c) } : c,
                ),
              }),
              false,
              'soundscape/generateEmpty',
            );
            releaseRefs();
            return { error: 'No sound is ready to generate' };
          }

          const generatedTargets = new Set(
            [
              ...generationConfigs,
              ...uploadedConfigs,
              ...libraryConfigs,
              ...catalogConfigs,
              ...elevenLabsConfigs,
              ...ttsConfigs,
            ].map(({ originalIndex }) => originalIndex),
          );

          // Concurrent invocations share the per-card maps: merge this one's cards in,
          // and reset the shared aggregate line only when nothing else is running.
          set(
            (s) => ({
              soundGenError: null,
              ...(_activeCount === 0
                ? { soundGenProgress: '', soundGenProgressValue: 0, soundGenStatusText: '' }
                : {}),
              soundGenCardProgress: {
                ...s.soundGenCardProgress,
                ...Object.fromEntries([...generatedTargets].map((i) => [i, 0])),
              },
              activeGenerationCardIndices: [...new Set([...s.activeGenerationCardIndices, ...generatedTargets])],
              soundGenCardStatus: {
                ...s.soundGenCardStatus,
                ...Object.fromEntries([...generatedTargets].map((i) => [i, 'Pending…'])),
              },
              soundConfigs: s.soundConfigs.map((c, i) =>
                generatedTargets.has(i) ? { ...c, error: null } : c,
              ),
            }),
            false,
            'soundscape/generateStart',
          );
          const controller = new AbortController();
          _abortControllers.add(controller);
          const invocation: GenerationInvocation = {
            controller,
            refs: [...refByIndex.values()],
            cancels: new Set(),
          };
          _invocations.add(invocation);
          beginSoundGeneration();
          trackGenerationTargets(targetIndices);
          let outcomeError: string | null = null;

          // Orchestrated cards: hold the mid-generation bake gate and bake the
          // schedule once up-front (released after the final bake below).
          let bakeHeld = [...generatedTargets].some((i) => !!soundConfigs[i]?.orchestrateMeta);
          if (bakeHeld) {
            const audio = useAudioControlsStore.getState();
            audio.acquireGenerationHold();
            audio.bakeOrchestrateSchedule();
          }
          const releaseBakeHold = () => {
            if (!bakeHeld) return;
            bakeHeld = false;
            useAudioControlsStore.getState().releaseGenerationHold();
          };

          // ── Orchestrate runs AFTER generation (see finalize below) so the agent
          // receives the measured clip durations rather than authored estimates. ──
          const orchestrateEnabled = get().orchestrateSoundsEnabled;
          const scenarioGroups = new Map<string, SoundGenerationConfig[]>();
          if (orchestrateEnabled) {
            // Only the configs being generated now. Re-orchestrating every
            // scenario present in the soundscape would let identical entry ids
            // (`footsteps_concrete_1`, …) bleed dynamics across scenarios.
            withIndices.forEach(({ config }) => {
              const src = config.scenarioSource;
              if (!src) return;
              const arr = scenarioGroups.get(src.scenarioId) ?? [];
              arr.push(config);
              scenarioGroups.set(src.scenarioId, arr);
            });
          }
          const hasTargetedScenario = withIndices.some(({ config }) => config.scenarioSource);
          _orchestrateProgressStatus = null;

          try {
            let generatedEvents: any[] = [];
            let uploadedEvents: any[] = [];
            let libraryEvents: any[] = [];
            let catalogEvents: any[] = [];
            let ttsEvents: any[] = [];
            let elevenLabsEvents: any[] = [];

            const globalBaseDbfs = useAudioControlsStore.getState().globalBaseDbfs;

            // All independent generation lanes are submitted up-front and run
            // concurrently. Each lane owns its events and never throws out to the
            // orchestrator — one failing lane/item cannot abort the others.
            const lanePromises: Promise<void>[] = [];

            // ── Backend ML generation (TangoFlux/AudioLDM2 — ONE GPU job) ──────
            if (generationConfigs.length > 0) {
              lanePromises.push((async () => {
                const hasEntities = generationConfigs.some(({ config }) => config.entities?.length);
                const configsWithNeg = generationConfigs.map(({ config }) => ({
                  ...config,
                  negative_prompt: globalNegativePrompt,
                }));

                const { generation_id } = await apiService.generateSounds({
                  sounds: configsWithNeg,
                  bounding_box: hasEntities ? null : geometryBounds,
                  apply_denoising: applyNoiseReduction,
                  trim_silence: trimSilence,
                  audio_model: audioModel,
                  base_dbfs: globalBaseDbfs,
                });
                if (controller.signal.aborted) {
                  apiService.cancelSoundGeneration(generation_id);
                  throw new Error('AbortError');
                }
                _activeSoundJobIds.add(generation_id);
                // The backend echoes the batch index as prompt_index.
                recordInflightJob(generation_id, 'sound', {
                  configIdByPromptIndex: configIdsByPromptIndex(
                    generationConfigs.map(({ config }, batchIdx) => [batchIdx, config.config_id] as const),
                  ),
                });

                // Map a raw backend sound object to a SoundEvent, resolving the
                // actual prompt_index and entity position from generationConfigs.
                const mapBackendSound = (sound: any) => {
                  const backendIndex = sound.prompt_index;
                  const actualIndex =
                    generationConfigs[backendIndex]?.originalIndex ?? backendIndex;
                  const originalConfig = generationConfigs[backendIndex]?.config;

                  // Re-key the ID on the card's config_id. Backend assigns batch-relative
                  // IDs ("generated_0_x" for the first sound in the batch), and a card
                  // index is no better: removals recycle indices, so either would let
                  // this sound's id collide with another card's and the id-keyed merge
                  // would silently replace it.
                  const copyIdx = parseSoundCopyIndex(sound.id ?? '', sound.copy_index);
                  const remappedId = cardEventId('generated', originalConfig?.config_id, copyIdx);
                  // Entity link, position, foley timestamps and category from the card.
                  // The backend position is ignored here (the card's wins, else origin).
                  const cardFields = generatedEventFieldsFromConfig(
                    { entity_index: sound.entity_index },
                    originalConfig,
                    actualIndex,
                  );

                  const event = {
                    ...sound,
                    id: remappedId,
                    prompt_index: actualIndex,
                    config_id: originalConfig?.config_id,
                    geometry: sound.geometry || { vertices: [], faces: [] },
                    ...cardFields,
                  };
                  return event;
                };

                // Poll until done, streaming each completed sound into the UI immediately.
                // The poll controller is scoped to this invocation and registered so
                // handleStopGeneration can cancel it — a concurrent invocation can no
                // longer clear this loop from its own finally.
                let lastPartialCount = 0;
                const mlPoll = soundPollRegistry.track(
                  startPolling({
                    fetchStatus: () => apiService.getSoundGenerationStatus(generation_id),
                    onStatus: (s) => {
                      setProgressLabel('generating sounds…', s.status);

                      // The GPU job processes clips in order — the first card with
                      // unfinished samples is the one currently generating.
                      const currentIdx = generationConfigs.find(
                        ({ originalIndex }) =>
                          (doneSamples[originalIndex] ?? 0) < (expectedSamples[originalIndex] ?? 1),
                      )?.originalIndex;
                      if (currentIdx !== undefined) setCardStatus(currentIdx, s.status || 'Generating…');

                      // Stream newly-completed sounds into the UI
                      if (s.partial_sounds && s.partial_sounds.length > lastPartialCount) {
                        const newPartials = s.partial_sounds.slice(lastPartialCount).map(mapBackendSound);
                        lastPartialCount = s.partial_sounds.length;
                        mergePartialEvents(newPartials);
                        newPartials.forEach((e: any) => bumpSamples(e.prompt_index, 1));
                      }
                    },
                  }),
                );
                invocation.cancels.add(() => {
                  mlPoll.stop(new Error('AbortError'));
                  apiService.cancelSoundGeneration(generation_id);
                });
                let mlResult: any[] = [];
                try {
                  mlResult = await mlPoll.done;
                } finally {
                  soundPollRegistry.release(mlPoll);
                  _activeSoundJobIds.delete(generation_id);
                  removeInflightJob(generation_id);
                }

                generatedEvents = mlResult.map(mapBackendSound);
              })().catch((err) => recordLaneError('generating sounds', err)));
            }

            // ── Uploaded / sample audio (calibration pool) ─────────────────────
            if (uploadedConfigs.length > 0) {
              lanePromises.push((async () => {
                const { results, errors } = await mapWithConcurrency(
                  uploadedConfigs,
                  async ({ config, originalIndex }) => {
                    setCardStatus(originalIndex, 'Generating…');
                    const audioFileUrl = config.uploadedAudioUrl;
                    if (!audioFileUrl) {
                      bumpSamples(originalIndex, 1);
                      return null;
                    }
                    const resolvedDbfs = config.dbfs ?? globalBaseDbfs;
                    // Files are calibrated to the GLOBAL base anchor; the per-sound
                    // target level (resolvedDbfs / orchestrator SPL) is applied at
                    // playback relative to that anchor. This keeps every source on one
                    // calibration reference so orchestrator mix levels are audible.
                    const { url: audioUrl, noise_trim } = await calibrateBlobUrl(
                      audioFileUrl,
                      globalBaseDbfs,
                      applyDenoising,
                      trimSilence,
                    );
                    const uploadedEvent = createSoundEventFromUpload(
                      { ...config, dbfs: resolvedDbfs },
                      audioUrl,
                      originalIndex,
                      total,
                      geometryBounds as GeometryBounds | undefined,
                      'uploaded',
                    );
                    if (noise_trim) {
                      useAudioControlsStore.getState().setSoundTrim(uploadedEvent.id, { start: noise_trim[0], end: noise_trim[1] });
                    }
                    mergePartialEvents([uploadedEvent]);
                    bumpSamples(originalIndex, 1);
                    return uploadedEvent;
                  },
                  SOUND_GEN_CONCURRENCY.CALIBRATE,
                  controller.signal,
                );
                uploadedEvents = results.filter(Boolean) as any[];
                errors.forEach(({ error }) => console.error('[soundscapeStore] Upload calibration error:', error));
              })().catch((err) => recordLaneError('uploaded audio', err)));
            }

            // ── Library ───────────────────────────────────────────────────────
            if (libraryConfigs.length > 0) {
              lanePromises.push((async () => {
                const { results, errors } = await mapWithConcurrency(
                  libraryConfigs,
                  async ({ config, originalIndex }) => {
                    setCardStatus(originalIndex, 'Generating…');
                    if (!config.selectedLibrarySound) {
                      bumpSamples(originalIndex, 1);
                      return null;
                    }
                    const dlRes = await fetch(`${API_BASE_URL}/api/library/download`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        location: config.selectedLibrarySound.location,
                        description: config.selectedLibrarySound.description,
                      }),
                      signal: controller.signal,
                    });
                    if (!dlRes.ok) throw new Error('Failed to download sound');
                    const resolvedDbfs = config.dbfs ?? globalBaseDbfs;
                    const { url: audioUrl, noise_trim } = await calibrateBlobUrl(
                      await dlRes.blob(),
                      globalBaseDbfs,
                      applyDenoising,
                      trimSilence,
                    );
                    const libraryEvent = createSoundEventFromUpload(
                      { ...config, dbfs: resolvedDbfs },
                      audioUrl,
                      originalIndex,
                      total,
                      geometryBounds as GeometryBounds | undefined,
                      'library',
                    );
                    if (noise_trim) {
                      useAudioControlsStore.getState().setSoundTrim(libraryEvent.id, { start: noise_trim[0], end: noise_trim[1] });
                    }
                    mergePartialEvents([libraryEvent]);
                    bumpSamples(originalIndex, 1);
                    return libraryEvent;
                  },
                  SOUND_GEN_CONCURRENCY.LIBRARY,
                  controller.signal,
                );
                libraryEvents = results.filter(Boolean) as any[];
                errors.forEach(({ error }) => console.error('[soundscapeStore] Library download error:', error));
              })().catch((err) => recordLaneError('library sounds', err)));
            }

            // ── Catalog ───────────────────────────────────────────────────────
            if (catalogConfigs.length > 0) {
              lanePromises.push((async () => {
                const { results, errors } = await mapWithConcurrency(
                  catalogConfigs,
                  async ({ config, originalIndex }) => {
                    setCardStatus(originalIndex, 'Generating…');
                    if (!config.selectedCatalogSound) {
                      bumpSamples(originalIndex, 1);
                      return null;
                    }
                    const dlRes = await fetch(config.selectedCatalogSound.url, {
                      signal: controller.signal,
                    });
                    if (!dlRes.ok) throw new Error('Failed to download catalog sound');
                    const resolvedDbfs = config.dbfs ?? globalBaseDbfs;
                    const { url: audioUrl, noise_trim } = await calibrateBlobUrl(
                      await dlRes.blob(),
                      globalBaseDbfs,
                      applyDenoising,
                      trimSilence,
                    );
                    const catalogEvent = createSoundEventFromUpload(
                      { ...config, dbfs: resolvedDbfs },
                      audioUrl,
                      originalIndex,
                      total,
                      geometryBounds as GeometryBounds | undefined,
                      'catalog',
                    );
                    if (noise_trim) {
                      useAudioControlsStore.getState().setSoundTrim(catalogEvent.id, { start: noise_trim[0], end: noise_trim[1] });
                    }
                    mergePartialEvents([catalogEvent]);
                    bumpSamples(originalIndex, 1);
                    return catalogEvent;
                  },
                  SOUND_GEN_CONCURRENCY.CATALOG,
                  controller.signal,
                );
                catalogEvents = results.filter(Boolean) as any[];
                errors.forEach(({ item, error }) => {
                  const errorMsg = error instanceof Error ? error.message : 'Failed to download catalog sound';
                  console.error('[soundscapeStore] Catalog download error:', error);
                  // Set per-card error
                  get().handleUpdateConfig(item.originalIndex, 'error', errorMsg);
                });
              })().catch((err) => recordLaneError('catalog sounds', err)));
            }

            // ── TTS (Gemini Text-to-Speech — ONE in-process job) ───────────────
            if (ttsConfigs.length > 0) {
              lanePromises.push((async () => {
                const ttsTexts: any[] = [];
                ttsConfigs.forEach(({ config, originalIndex }) => {
                  // Speech lines come from either an orchestrate-compiled entry
                  // (orchestrateMeta.speechLines) or a scenario-derived "incomplete"
                  // card (scenarioSource.speechLines, pre-orchestrate).
                  const speechLines = ((config as any).orchestrateMeta?.speechLines
                    ?? config.scenarioSource?.speechLines) as string[] | undefined;
                  if (speechLines && speechLines.length > 0) {
                    // Each speech line is an independent dialogue sample — generate all
                    // of them as variants of the same card (same prompt_index, different
                    // copy_index).  This makes them appear as one DAW track with variant
                    // selector letters A/B/C, matching how non-TTS seed_copies work.
                    speechLines.forEach((lineText, lineIdx) => {
                      ttsTexts.push({
                        text: lineText,
                        voice_name: config.voice_name,
                        display_name: config.display_name || lineText,
                        position: config.position,
                        // Calibrate the WAV to the global anchor; the per-sound level
                        // (config.dbfs / orchestrator SPL) is applied at playback.
                        dbfs: globalBaseDbfs,
                        prompt_index: originalIndex,
                        copy_index: lineIdx,
                        total_copies: speechLines.length,
                        speech_card_index: originalIndex,
                      });
                    });
                  } else {
                    // No speech lines: generate seed_copies variants of the same prompt.
                    const copies = Math.max(1, config.seed_copies ?? 1);
                    for (let copyIdx = 0; copyIdx < copies; copyIdx++) {
                      ttsTexts.push({
                        text: config.prompt,
                        voice_name: config.voice_name,
                        display_name: config.display_name || config.prompt,
                        position: config.position,
                        dbfs: globalBaseDbfs,
                        // Carry the card's config index + variant index so the backend can
                        // echo them back. Mirrors the text-to-audio flow (sounds_worker),
                        // making variant grouping robust to backend re-indexing/filtering.
                        prompt_index: originalIndex,
                        copy_index: copyIdx,
                        total_copies: copies,
                      });
                    }
                  }
                });

                const { generation_id } = await apiService.generateTTS({
                  texts: ttsTexts,
                  language: useAudioControlsStore.getState().ttsLanguage,
                  tts_model: get().ttsModel,
                });
                if (controller.signal.aborted) {
                  apiService.cancelTTSGeneration(generation_id);
                  throw new Error('AbortError');
                }
                _activeTtsJobIds.add(generation_id);
                // The backend echoes the card index as prompt_index.
                recordInflightJob(generation_id, 'tts', {
                  configIdByPromptIndex: configIdsByPromptIndex(
                    ttsConfigs.map(({ config, originalIndex }) => [originalIndex, config.config_id] as const),
                  ),
                });

                const mapTtsSound = (sound: any) => {
                  // prompt_index is the card index (same for all speech lines).
                  // copy_index distinguishes speech lines (0, 1, 2, …) as variants.
                  const actualIndex = sound.prompt_index ?? 0;
                  const copyIdx = sound.copy_index ?? 0;
                  const cardIdx = sound.speech_card_index ?? actualIndex;
                  const originalConfig = ttsConfigs.find(
                    ({ originalIndex }) => originalIndex === cardIdx,
                  )?.config;

                  let position: number[] = [0, 0, 0];
                  if (originalConfig?.entities?.[0]?.bounds?.center) {
                    position = originalConfig.entities[0].bounds.center as number[];
                  } else if (originalConfig?.entities?.[0]?.position) {
                    position = originalConfig.entities[0].position as number[];
                  } else if (originalConfig?.position) {
                    position = originalConfig.position as number[];
                  }

                  const voice = sound.voice_name || originalConfig?.voice_name || 'TTS';
                  const remappedId = cardEventId('tts', originalConfig?.config_id, copyIdx, voice);

                  const ttsDisplayName = sound.display_name
                    || originalConfig?.display_name
                    || originalConfig?.prompt
                    || `TTS ${actualIndex + 1}`;

                  // Authored dialogue timestamps (MM:SS) for the whole character
                  // block. Attached like foley `configTimestamps` so speech has a
                  // narrative-order fallback whenever the parametric orchestrate
                  // bake cannot place it (e.g. a cyclic/unknown-duration graph).
                  const authoredSpeechTimestamps: string[] | undefined =
                    (originalConfig as any)?.orchestrateMeta?.timestamps
                    ?? (originalConfig as any)?.scenarioSource?.timestamps;

                  // Card-level entity link: speech lines must stay attached to the
                  // same object as the card, otherwise they render as free spheres.
                  let ttsEntityIndex: number | undefined;
                  if (originalConfig?.entities?.[0]?.index !== undefined) {
                    ttsEntityIndex = originalConfig.entities[0].index;
                  } else if (originalConfig?.entities?.[0]?.nodeId || originalConfig?.entities?.[0]?.id) {
                    ttsEntityIndex = cardIdx;
                  }
                  const ttsEntityIndices = originalConfig?.entities?.length
                    ? originalConfig.entities
                        .map((e: any) => e.index)
                        .filter((i: any) => i !== undefined)
                    : undefined;

                  const mapped = {
                    ...sound,
                    id: remappedId,
                    prompt_index: actualIndex,
                    config_id: originalConfig?.config_id,
                    copy_index: copyIdx,
                    position,
                    geometry: sound.geometry || { vertices: [], faces: [] },
                    isUploaded: true,
                    // Backend echoes the calibration dbfs (global anchor) — the
                    // playback TARGET is the card's own level / orchestrator SPL.
                    volume_dbfs: originalConfig?.dbfs ?? globalBaseDbfs,
                    category: originalConfig?.category || 'speech',
                    display_name: ttsDisplayName,
                    ...(ttsEntityIndex !== undefined && { entity_index: ttsEntityIndex }),
                    ...(ttsEntityIndices?.length ? { entity_indices: ttsEntityIndices } : {}),
                    ...(authoredSpeechTimestamps?.length
                      ? { timestamps: authoredSpeechTimestamps }
                      : {}),
                  };
                  return mapped;
                };

                let ttsLastPartialCount = 0;
                const ttsPoll = soundPollRegistry.track(
                  startPolling({
                    fetchStatus: () => apiService.getTTSGenerationStatus(generation_id),
                    onStatus: (s) => {
                      setProgressLabel('generating speech…', s.status);

                      // The TTS job processes items in order — the first card with
                      // unfinished samples is the one currently generating.
                      const currentIdx = ttsConfigs.find(
                        ({ originalIndex }) =>
                          (doneSamples[originalIndex] ?? 0) < (expectedSamples[originalIndex] ?? 1),
                      )?.originalIndex;
                      if (currentIdx !== undefined) setCardStatus(currentIdx, s.status || 'Generating…');

                      if (s.partial_sounds && s.partial_sounds.length > ttsLastPartialCount) {
                        const newPartials = s.partial_sounds.slice(ttsLastPartialCount).map(mapTtsSound);
                        ttsLastPartialCount = s.partial_sounds.length;
                        mergePartialEvents(newPartials);
                        newPartials.forEach((e: any) => bumpSamples(e.prompt_index, 1));
                      }
                    },
                  }),
                );
                invocation.cancels.add(() => {
                  ttsPoll.stop(new Error('AbortError'));
                  apiService.cancelTTSGeneration(generation_id);
                });
                let ttsResult: any[] = [];
                try {
                  ttsResult = await ttsPoll.done;
                } finally {
                  soundPollRegistry.release(ttsPoll);
                  _activeTtsJobIds.delete(generation_id);
                  removeInflightJob(generation_id);
                }

                ttsEvents = ttsResult.map(mapTtsSound);
              })().catch((err) => recordLaneError('generating speech', err)));
            }

            // ── ElevenLabs (browser pool) ───────────────────────────────────────
            // ElevenLabs takes a different request shape from TangoFlux:
            //  - duration is omitted for background beds and short (<4 s) events,
            //    otherwise the target (LLM) duration is passed;
            //  - background beds request a seamless loop (opt-in per config);
            //  - prompt_influence replaces the diffusion guidance scale;
            //  - noise reduction is never applied (only optional silence trimming).
            // Like TangoFlux, a config generates `seed_copies` variants so repeated
            // occurrences can rotate instead of retriggering one clip.
            if (elevenLabsConfigs.length > 0) {
              lanePromises.push((async () => {
                const { results, errors } = await mapWithConcurrency(
                  elevenLabsConfigs,
                  async ({ config, originalIndex }): Promise<any[]> => {
                    setCardStatus(originalIndex, 'Generating…');
                    const isBackground = normalizeSoundCategory(config.category) === 'background';
                    const loop = config.loop ?? (isBackground || DEFAULT_SOUND_LOOP);
                    const copies = Math.max(1, config.seed_copies ?? 1);
                    const events: any[] = [];
                    for (let copyIdx = 0; copyIdx < copies; copyIdx++) {
                      const rawUrl = await generateSoundEffect({
                        text: config.prompt,
                        durationSeconds: elevenLabsDurationSeconds(config, isBackground),
                        loop,
                        promptInfluence: config.prompt_influence ?? DEFAULT_PROMPT_INFLUENCE,
                      });
                      const resolvedDbfs = config.dbfs ?? globalBaseDbfs;
                      const { url: audioUrl, noise_trim } = await calibrateBlobUrl(
                        rawUrl,
                        globalBaseDbfs,
                        false, // noise reduction never applies to ElevenLabs
                        trimSilence,
                      );
                      const baseEvent = createSoundEventFromUpload(
                        { ...config, dbfs: resolvedDbfs, ...(loop ? { interval_seconds: 0 } : {}) },
                        audioUrl,
                        originalIndex,
                        total,
                        geometryBounds as GeometryBounds | undefined,
                        'elevenlabs',
                      );
                      const elevenLabsEvent: any = {
                        ...baseEvent,
                        id: cardEventId('elevenlabs', config.config_id, copyIdx),
                        copy_index: copyIdx,
                        total_copies: copies,
                      };
                      if (noise_trim) {
                        useAudioControlsStore.getState().setSoundTrim(elevenLabsEvent.id, { start: noise_trim[0], end: noise_trim[1] });
                      }
                      mergePartialEvents([elevenLabsEvent]);
                      bumpSamples(originalIndex, 1);
                      events.push(elevenLabsEvent);
                    }
                    return events;
                  },
                  SOUND_GEN_CONCURRENCY.ELEVENLABS,
                  controller.signal,
                );
                elevenLabsEvents = results.flat().filter(Boolean) as any[];
                errors.forEach(({ error }) => console.error('[soundscapeStore] ElevenLabs error:', error));
              })().catch((err) => recordLaneError('ElevenLabs', err)));
            }

            // ── Fan-in: every lane runs concurrently; wait for all of them ────
            await Promise.allSettled(lanePromises);

            // A user stop must short-circuit merge / orchestrate / bake.
            if (controller.signal.aborted) {
              const abortErr = new Error('AbortError');
              abortErr.name = 'AbortError';
              throw abortErr;
            }

            if (laneErrors.length > 0) {
              notifySectionError(
                `Some sounds failed — ${laneErrors.slice(0, 3).join('; ')}`,
                'error',
              );
            }

            // ── Merge ─────────────────────────────────────────────────────────
            // Read the FRESH state at merge time (not the start-of-invocation
            // snapshot) so a concurrently-streaming/merging generation's events
            // are preserved instead of being overwritten.
            // Prefer the live `generatedSounds` list (kept up to date by partial
            // streaming from every lane); `soundscapeData` is only updated at the
            // end of a run and can be stale while lanes are still merging.
            const liveSounds = get().generatedSounds || [];
            const existing = (liveSounds.length > 0 ? liveSounds : (get().soundscapeData || [])).slice();
            const newEvents = relocate([
              ...generatedEvents,
              ...uploadedEvents,
              ...libraryEvents,
              ...catalogEvents,
              ...ttsEvents,
              ...elevenLabsEvents,
            ]);
            // Targets / forced cards at their live indices (other cards may have been removed).
            const liveTargets = liveIndices(withIndices.map(({ originalIndex }) => originalIndex));
            const liveForced = liveIndices(forcedIndices);
            // New variants of an already-simulated prompt must share the prompt's source
            // position (they are ONE acoustic source). A fresh variant carries the config
            // position ([0,0,0] until placed) — inherit the existing variant's position so
            // the simulation never sees the prompt at two different spots.
            const newEventIds = new Set(newEvents.map((e) => e.id));
            // Cards that produced fresh events in this run (snapshot + stale-drop scope).
            const cardsWithNewEvents = new Set(
              liveTargets.filter((index) => newEvents.some((e) => promptMatchesCard(e.prompt_index, index))),
            );
            // A forced regeneration replaces the card's variant set: drop old
            // variants the new run did not reproduce (e.g. fewer seed copies).
            const isStaleForcedEvent = (e: any) =>
              !newEventIds.has(e.id) &&
              liveForced.some((i) =>
                cardsWithNewEvents.has(i) && promptMatchesCard(e.prompt_index, i));
            const staleEventIds = existing.filter(isStaleForcedEvent).map((e) => e.id).filter(Boolean);
            // Each fresh variant remembers the inputs it was made from, so selecting
            // it later shows those settings in the card's settings editor.
            const liveConfigs = get().soundConfigs;
            const withVariantSignature = (e: any) => {
              const cardIndex = [...cardsWithNewEvents].find((i) => promptMatchesCard(e.prompt_index, i));
              const cardConfig = cardIndex !== undefined ? liveConfigs[cardIndex] : undefined;
              const signature = cardConfig ? captureVariantSignature(cardConfig, e) : undefined;
              return signature ? { ...e, generated_signature: signature } : e;
            };
            const allEvents = [
              ...existing.filter((e) => !newEventIds.has(e.id) && !isStaleForcedEvent(e)),
              ...newEvents.map((e) => {
                const tagged = withVariantSignature(e);
                if (tagged.prompt_index === undefined) return tagged;
                const anchor = existing.find(
                  (x) => x.prompt_index === tagged.prompt_index && x.id !== tagged.id && x.position?.length === 3,
                );
                return anchor ? { ...tagged, position: anchor.position } : tagged;
              }),
            ];

            console.log('[handleGenerateInternal] merge: generated:', generatedEvents.length,
              'uploaded:', uploadedEvents.length,
              'library:', libraryEvents.length,
              'catalog:', catalogEvents.length,
              'tts:', ttsEvents.length,
              'elevenLabs:', elevenLabsEvents.length,
              'existing:', existing.length,
              'allEvents:', allEvents.length);

            set(
              (s) => ({
                generatedSounds: allEvents,
                soundscapeData: allEvents.length > 0 ? allEvents : null,
                // Snapshot the generation inputs so later edits surface "Regenerate".
                soundConfigs: s.soundConfigs.map((c, i) =>
                  cardsWithNewEvents.has(i) ? { ...c, ...captureGenerationSignature(c) } : c,
                ),
              }),
              false,
              'soundscape/generateDone',
            );
            applyTrimRegions(allEvents);
            if (staleEventIds.length > 0) {
              useAudioControlsStore.getState().pruneSounds(staleEventIds);
            }

            // Fresh audio must not inherit a stale schedule. New ids are keyed on
            // config_id, so they are never recycled across cards, but they are stable
            // per card: a forced regeneration reuses the same ids. A persisted manual
            // timestamp from the previous take would otherwise be adopted as this
            // sound's schedule and silently misplace it.
            {
              const targetedIdxSet = new Set(liveTargets);
              const generatedIds = allEvents
                .filter((e: any) => targetedIdxSet.has(e.prompt_index))
                .map((e: any) => e.id)
                .filter(Boolean);
              useAudioControlsStore.getState().clearSoundTimestampsFor(generatedIds);
            }

            // All lanes have settled — force the aggregate to 100% and drop any
            // remaining in-flight card markers (a failed item never bumps its
            // counter, so this prevents a progress bar stuck below 100).
            set(
              (s) => ({
                soundGenProgress: `${totalSamples}/${totalSamples} finalizing…`,
                soundGenProgressValue: 100,
                soundGenStatusText: '',
                ...withoutGenerationCards(s, liveIndices(generatedTargets), true),
              }),
              false,
              'soundscape/generateProgress',
            );

            // ── Orchestrate (AFTER generation, with measured durations) ──────────
            // The agent runs once the scenario clips are decoded so it can order
            // strictly and estimate end-to-start delays against real lengths.
            if (orchestrateEnabled && hasTargetedScenario && scenarioGroups.size > 0) {
              set(
                (s) => ({
                  soundGenProgress: 'Orchestrating timeline…',
                  soundGenProgressValue: 100,
                  isOrchestrating: true,
                  orchestratingScenarioIds: [...new Set([...s.orchestratingScenarioIds, ...scenarioGroups.keys()])],
                  orchestrateThinking: '',
                }),
                false,
                'soundscape/orchestrateStart',
              );
              const currentConfigs = get().soundConfigs;
              const targetedIndices = new Set(
                liveIndices(
                  withIndices
                    .filter(({ config }) => !!config.scenarioSource)
                    .map(({ originalIndex }) => originalIndex),
                ),
              );
              const scenarioSoundIds: string[] = [];
              currentConfigs.forEach((c, i) => {
                if (!c.scenarioSource || !targetedIndices.has(i)) return;
                get().generatedSounds.forEach((s: any) => {
                  if (s.prompt_index === i) scenarioSoundIds.push(s.id);
                });
              });
              await waitForSoundBuffers(scenarioSoundIds, 30000);
              const timings = buildEntryTimings(
                currentConfigs,
                get().generatedSounds,
                useAudioControlsStore.getState().soundBufferDurations,
                useAudioControlsStore.getState().soundTrims,
              );
              try {
                const { entryById, orchestrateIdByScenario } = await runOrchestrationForSources(
                  scenarioGroups,
                  controller.signal,
                  // Reactive — the status line reads `soundGenProgress` from the store.
                  (status) => {
                    _orchestrateProgressStatus = status;
                    set({ soundGenProgress: status }, false, 'soundscape/orchestrateProgress');
                  },
                  timings,
                  'initial',
                  (thinking) => set({ orchestrateThinking: thinking }, false, 'soundscape/orchestrateThinking'),
                );
                if (entryById.size > 0) {
                  applyOrchestrateDynamics(entryById, orchestrateIdByScenario);
                }
              } finally {
                _orchestrateProgressStatus = null;
                set(
                  (s) => {
                    const ids = s.orchestratingScenarioIds.filter((id) => !scenarioGroups.has(id));
                    return {
                      orchestratingScenarioIds: ids,
                      isOrchestrating: ids.length > 0 || s.isReorchestrating,
                      ...(ids.length === 0 ? { orchestrateThinking: '' } : {}),
                    };
                  },
                  false,
                  'soundscape/orchestrateEnd',
                );
              }
            }

            // ── Final orchestrator finalize — now that ALL generated sounds (ML +
            // TTS + upload/library/catalog/ElevenLabs) are merged. Stamp the
            // variant/entity links from orchestrateMeta and re-bake the parametric
            // schedule so after()/alignEnd() use real durations. Driven by the
            // pipeline (not a React effect) so it always runs with fresh state. ──
            {
              const audioStore = useAudioControlsStore.getState();
              releaseBakeHold();
              const finalConfigs = get().soundConfigs;
              if (finalConfigs.some((c) => c.orchestrateMeta)) {
                audioStore.syncSoundConfigs(finalConfigs);
                audioStore.syncGeneratedSounds(get().generatedSounds);
                audioStore.setOrchestrateIterationLinks(finalConfigs);
                // Capture the orchestrator result for "Reset track" once the bake applies.
                // `notify: true` — this is the authoritative orchestrator-job bake, the
                // only place orchestrate warnings (exclusions / authored fallbacks /
                // self-overlap) may surface as toasts.
                audioStore.bakeOrchestrateSchedule(() => {
                  useAudioControlsStore.getState().saveOrchestrateResult();
                }, { notify: true });
              }
              // Baseline for the "Re-orchestrate timeline" button: the agent inputs
              // as they are right now (post-generation, pre-user-edit).
              set(
                { orchestrateBaselineSignature: orchestrateInputsSignature(finalConfigs) },
                false,
                'soundscape/orchestrateBaseline',
              );
            }
          } catch (err: any) {
            if (err.name === 'AbortError' || err.message === 'AbortError') {
              const msg = 'Sound generation stopped by user.';
              outcomeError = msg;
              set({ soundGenError: msg }, false, 'soundscape/generateAbort');
              notifySectionError(msg, 'info');
            } else {
              const isQuota = err.message.includes('quota') || err.message.includes('429');
              outcomeError = err.message;
              set({ soundGenError: err.message }, false, 'soundscape/generateError');
              notifySectionError(err.message, isQuota ? 'warning' : 'error');
            }
          } finally {
            endSoundGeneration();
            untrackGenerationTargets(targetIndices);
            const ownCards = liveIndices(generatedTargets);
            set(
              (s) => ({
                ...withoutGenerationCards(s, ownCards),
                // The aggregate line is shared — reset it once the last generation ends.
                ...(_activeCount === 0
                  ? { soundGenProgress: '', soundGenProgressValue: 0, soundGenStatusText: '' }
                  : {}),
              }),
              false,
              'soundscape/generateEnd',
            );
            _abortControllers.delete(controller);
            _invocations.delete(invocation);
            releaseRefs();
            // Safety net — never leave the bake gate held after the pipeline ends.
            releaseBakeHold();
          }
          return { error: outcomeError };
        },

        handleRegenerateSingle: async (targetIndex) => {
          const state = get();
          const config = state.soundConfigs[targetIndex];
          if (!config) return;

          const {
            soundscapeData,
            applyNoiseReduction,
            trimSilence,
            audioModel,
            globalNegativePrompt,
            regeneratingIndices,
          } = state;
          const { geometryBounds } = useFileUploadStore.getState();

          // Prevent duplicate regeneration
          if (regeneratingIndices.includes(targetIndex)) return;

          // Auto-switch to the predicted new variant index
          const pendingVariantIdx = (soundscapeData || []).filter((s: any) => s.prompt_index === targetIndex).length;
          useAudioControlsStore.getState().handleVariantChange(targetIndex, pendingVariantIdx);
          // Once the new variant lands, its settings become the card's baseline
          // (unless the user switched to another variant meanwhile).
          const showNewVariantSettings = (variantId: string) => {
            if (useAudioControlsStore.getState().selectedVariants[targetIndex] !== pendingVariantIdx) return;
            get().applyVariantGenerationSettings(targetIndex, variantId);
          };

          set(
            {
              soundGenProgress: 'Regenerating...',
              soundGenProgressValue: 0,
              soundGenStatusText: '',
              regeneratingIndices: [...regeneratingIndices, targetIndex],
            },
            false,
            'soundscape/regenStart',
          );
          beginSoundGeneration();
          trackGenerationTargets([targetIndex]);

          try {
            // ElevenLabs regenerates client-side — never through the TangoFlux
            // backend. Mirrors the ElevenLabs branch of handleGenerateInternal
            // (duration for long non-background events, seamless loop for
            // background beds, prompt influence).
            if (audioModel === AUDIO_MODEL_ELEVENLABS) {
              const globalBaseDbfs = useAudioControlsStore.getState().globalBaseDbfs;
              const isBackground = normalizeSoundCategory(config.category) === 'background';
              const loop = config.loop ?? (isBackground || DEFAULT_SOUND_LOOP);
              const rawUrl = await generateSoundEffect({
                text: config.prompt,
                durationSeconds: elevenLabsDurationSeconds(config, isBackground),
                loop,
                promptInfluence: config.prompt_influence ?? DEFAULT_PROMPT_INFLUENCE,
              });
              const resolvedDbfs = config.dbfs ?? globalBaseDbfs;
              const { url: audioUrl, noise_trim } = await calibrateBlobUrl(
                rawUrl,
                globalBaseDbfs,
                false, // noise reduction never applies to ElevenLabs
                trimSilence,
              );

              const currentForCopy = get().soundscapeData || [];
              const existingCopyIdx = currentForCopy
                .filter((x: any) => x.prompt_index === targetIndex)
                .map((x: any) => parseSoundCopyIndex(x.id ?? '', x.copy_index))
                .filter((n: number) => !isNaN(n));
              const newCopy = (existingCopyIdx.length > 0 ? Math.max(...existingCopyIdx) : -1) + 1;

              const baseEvent = createSoundEventFromUpload(
                { ...config, dbfs: resolvedDbfs, ...(loop ? { interval_seconds: 0 } : {}) },
                audioUrl,
                targetIndex,
                1,
                geometryBounds as GeometryBounds | undefined,
                'elevenlabs',
              );
              const newEvent: any = {
                ...baseEvent,
                id: cardEventId('elevenlabs', config.config_id, newCopy),
                copy_index: newCopy,
                generated_signature: captureVariantSignature(config, {}),
              };
              if (noise_trim) {
                useAudioControlsStore.getState().setSoundTrim(newEvent.id, { start: noise_trim[0], end: noise_trim[1] });
              }

              // New variants share the prompt's source position (one acoustic source).
              const anchor = currentForCopy.find(
                (x: any) => x.prompt_index === targetIndex && x.position?.length === 3,
              );
              const alignedEvent = anchor ? { ...newEvent, position: anchor.position } : newEvent;
              const merged = [...currentForCopy, alignedEvent];
              set({ generatedSounds: merged, soundscapeData: merged }, false, 'soundscape/regenComplete');
              applyTrimRegions([alignedEvent]);
              showNewVariantSettings(alignedEvent.id);
              // `finally` below clears the regenerating indicator / progress.
              return;
            }

            // Mirror handleGenerateInternal: the global negative prompt is what
            // the TTA models (TangoFlux/AudioLDM2) actually receive, so a
            // regenerate must apply it too — not the card's (empty) per-config value.
            const configForGeneration = {
              ...config,
              seed_copies: 1,
              negative_prompt: globalNegativePrompt,
              _regeneration_ts: Date.now(),
            };

            const result = await apiService.generateSounds({
              sounds: [configForGeneration],
              bounding_box: config.entities?.length ? null : geometryBounds,
              apply_denoising: applyNoiseReduction,
              trim_silence: trimSilence,
              audio_model: audioModel,
            });
            if (!result) throw new Error('Failed to submit regeneration');
            const { generation_id } = result;
            _activeSoundJobIds.add(generation_id);
            recordInflightJob(generation_id, 'sound', {
              configIdByPromptIndex: configIdsByPromptIndex([[0, config.config_id]]),
            });

            const regenPoll = soundPollRegistry.track(
              startPolling({
                fetchStatus: () => apiService.getSoundGenerationStatus(generation_id),
                onStatus: (s) => {
                  set(
                    {
                      soundGenProgress: combinedProgress(s.status),
                      soundGenProgressValue: s.progress,
                      soundGenStatusText: combinedProgress(s.status),
                    },
                    false,
                    'soundscape/regenPoll',
                  );
                },
              }),
            );
            let mlResult: any[] = [];
            try {
              mlResult = await regenPoll.done;
            } finally {
              soundPollRegistry.release(regenPoll);
              _activeSoundJobIds.delete(generation_id);
              removeInflightJob(generation_id);
            }

            // Allocate the new variant's copy index against the CURRENT variant set
            // (computed at merge time, not click time) so a concurrently-streamed
            // variant can never claim the same copy_index / id.
            const currentForCopy = get().soundscapeData || [];
            const existingCopyIdx = currentForCopy
              .filter((x: any) => x.prompt_index === targetIndex)
              .map((x: any) => parseSoundCopyIndex(x.id ?? '', x.copy_index))
              .filter((n: number) => !isNaN(n));
            const newCopyBase = (existingCopyIdx.length > 0 ? Math.max(...existingCopyIdx) : -1) + 1;
            const mappedEvents = mlResult.map((sound: any, idx: number) => {
              const copyIdx = newCopyBase + idx;

              let position: number[] = [0, 0, 0];
              if (config.entities?.[0]?.bounds?.center) {
                position = config.entities[0].bounds.center as number[];
              } else if (config.entities?.[0]?.position) {
                position = config.entities[0].position as number[];
              } else if (config.position) {
                position = config.position as number[];
              }

              let entityIndex: number | undefined;
              if (config.entities?.[0]?.index !== undefined) {
                entityIndex = config.entities[0].index;
              } else if (config.entities?.[0]?.nodeId || config.entities?.[0]?.id) {
                entityIndex = targetIndex;
              }
              // A new variant of an already-linked card must inherit the SAME
              // card-level entity link, otherwise it would render as a free sphere.
              const entityIndices = config.entities?.length
                ? config.entities
                    .map((e: any) => e.index)
                    .filter((i: any) => i !== undefined)
                : undefined;

              return {
                ...sound,
                id: cardEventId('generated', config.config_id, copyIdx),
                prompt_index: targetIndex,
                config_id: config.config_id,
                copy_index: copyIdx,
                position,
                geometry: sound.geometry || { vertices: [], faces: [] },
                generated_signature: captureVariantSignature(config, {}),
                ...(entityIndex !== undefined && { entity_index: entityIndex }),
                ...(entityIndices?.length ? { entity_indices: entityIndices } : {}),
              };
            });

            const currentData = get().soundscapeData || [];
            // New variants share the prompt's source position: inherit the position of an
            // existing variant of the same prompt so the source does not split in the sim.
            const anchor = currentData.find(
              (x: any) => x.prompt_index === targetIndex && x.id !== mappedEvents[0]?.id && x.position?.length === 3,
            );
            const alignedEvents = anchor
              ? mappedEvents.map((e) => ({ ...e, position: anchor.position }))
              : mappedEvents;
            const merged = [...currentData, ...alignedEvents];
            set({ generatedSounds: merged, soundscapeData: merged }, false, 'soundscape/regenComplete');
            applyTrimRegions(alignedEvents);
            if (alignedEvents[0]) showNewVariantSettings(alignedEvents[0].id);
          } catch (err: any) {
            if (err?.message !== 'AbortError') {
              const msg = `Regeneration failed: ${err?.message || err}`;
              set({ soundGenError: msg }, false, 'soundscape/regenError');
              notifySectionError(msg);
            }
          } finally {
            endSoundGeneration();
            untrackGenerationTargets([targetIndex]);
            set(
              {
                soundGenProgress: '',
                soundGenProgressValue: 0,
                soundGenStatusText: '',
                regeneratingIndices: get().regeneratingIndices.filter(i => i !== targetIndex),
              },
              false,
              'soundscape/regenEnd',
            );
          }
        },

        regenerateVariantInPlace: async (targetIndex, variantIdx, newPrompt) => {
          const state = get();
          const config = state.soundConfigs[targetIndex];
          if (!config) return;
          if (state.regeneratingVariantIndices.includes(targetIndex)) return;

          const isTts = config.type === 'text-to-speech';
          const { soundscapeData, applyNoiseReduction, trimSilence, audioModel } = state;
          const data = soundscapeData || [];

          // Ordered variants for this card — matches the VariantsBar letter order.
          const variants = data
            .filter((s: any) => promptMatchesCard(s.prompt_index, targetIndex))
            .sort((a: any, b: any) => ((a.copy_index ?? 0) - (b.copy_index ?? 0)));
          const target = variants[variantIdx] ?? variants[0];
          if (!target) return;

          // Resolve the prompt this variant was generated from. TTS variants each
          // map to a speech line; text-to-audio variants share the card prompt.
          const speechLines = (config.orchestrateMeta?.speechLines
            ?? config.scenarioSource?.speechLines) as string[] | undefined;
          const currentPrompt = isTts && speechLines?.length
            ? (speechLines[variantIdx] ?? config.prompt)
            : config.prompt;
          const prompt = ((newPrompt ?? currentPrompt) || '').trim() || currentPrompt;

          // A user-edited prompt is written back onto the config / its speech line
          // so the settings summary and later regenerations stay in sync.
          if (newPrompt !== undefined && newPrompt !== currentPrompt) {
            if (isTts && speechLines?.length) {
              const newLines = [...speechLines];
              newLines[variantIdx] = prompt;
              if (config.scenarioSource && !config.orchestrateMeta?.speechLines) {
                get().handleUpdateConfig(targetIndex, 'scenarioSource', {
                  ...config.scenarioSource,
                  speechLines: newLines,
                });
              } else if (config.orchestrateMeta) {
                get().handleUpdateConfig(targetIndex, 'orchestrateMeta', {
                  ...config.orchestrateMeta,
                  speechLines: newLines,
                });
              }
            }
            get().handleUpdateConfig(targetIndex, 'prompt', prompt);
          }

          set(
            {
              regeneratingVariantIndices: [...get().regeneratingVariantIndices, targetIndex],
              soundGenProgress: 'Regenerating…',
              soundGenProgressValue: 0,
              soundGenStatusText: '',
            },
            false,
            'soundscape/regenVariantStart',
          );
          beginSoundGeneration();
          trackGenerationTargets([targetIndex]);

          try {
            let patch: Record<string, any> = {};

            if (isTts) {
              const globalBaseDbfs = useAudioControlsStore.getState().globalBaseDbfs;
              const { generation_id } = await apiService.generateTTS({
                texts: [{
                  text: prompt,
                  voice_name: config.voice_name,
                  display_name: config.display_name || prompt,
                  position: target.position ?? config.position,
                  dbfs: config.dbfs ?? globalBaseDbfs,
                  prompt_index: target.prompt_index ?? targetIndex,
                  copy_index: target.copy_index ?? variantIdx,
                  total_copies: speechLines?.length ?? target.total_copies ?? 1,
                }],
                language: useAudioControlsStore.getState().ttsLanguage,
                tts_model: get().ttsModel,
              });
              _activeTtsJobIds.add(generation_id);
              recordInflightJob(generation_id, 'tts', {
                configIdByPromptIndex: configIdsByPromptIndex([
                  [target.prompt_index ?? targetIndex, config.config_id],
                ]),
              });

              const poll = soundPollRegistry.track(startPolling({
                fetchStatus: () => apiService.getTTSGenerationStatus(generation_id),
                onStatus: (s) => set({ soundGenProgressValue: s.progress }, false, 'soundscape/regenVariantPoll'),
              }));
              let ttsResult: any[] = [];
              try {
                ttsResult = await poll.done;
              } finally {
                soundPollRegistry.release(poll);
                _activeTtsJobIds.delete(generation_id);
                removeInflightJob(generation_id);
              }
              const s = ttsResult[0];
              if (s) {
                patch = {
                  url: s.url,
                  duration: s.duration ?? target.duration,
                  volume_dbfs: config.dbfs ?? target.volume_dbfs,
                };
              }
            } else if (audioModel === AUDIO_MODEL_ELEVENLABS) {
              const globalBaseDbfs = useAudioControlsStore.getState().globalBaseDbfs;
              const isBackground = normalizeSoundCategory(config.category) === 'background';
              const loop = config.loop ?? (isBackground || DEFAULT_SOUND_LOOP);
              const rawUrl = await generateSoundEffect({
                text: prompt,
                durationSeconds: elevenLabsDurationSeconds(config, isBackground),
                loop,
                promptInfluence: config.prompt_influence ?? DEFAULT_PROMPT_INFLUENCE,
              });
              const resolvedDbfs = config.dbfs ?? globalBaseDbfs;
              const { url: audioUrl, noise_trim } = await calibrateBlobUrl(
                rawUrl,
                globalBaseDbfs,
                false, // noise reduction never applies to ElevenLabs
                trimSilence,
              );
              patch = {
                url: audioUrl,
                volume_dbfs: resolvedDbfs,
                ...(noise_trim ? { noise_trim } : {}),
              };
            } else {
              const configForGeneration = { ...config, prompt, seed_copies: 1, _regeneration_ts: Date.now() };
              const result = await apiService.generateSounds({
                sounds: [configForGeneration],
                bounding_box: config.entities?.length ? null : useFileUploadStore.getState().geometryBounds,
                apply_denoising: applyNoiseReduction,
                trim_silence: trimSilence,
                audio_model: audioModel,
              });
              if (!result) throw new Error('Failed to submit regeneration');
              const { generation_id } = result;
              _activeSoundJobIds.add(generation_id);
              recordInflightJob(generation_id, 'sound', {
                configIdByPromptIndex: configIdsByPromptIndex([[0, config.config_id]]),
              });

              const poll = soundPollRegistry.track(startPolling({
                fetchStatus: () => apiService.getSoundGenerationStatus(generation_id),
                onStatus: (s) => set({ soundGenProgressValue: s.progress }, false, 'soundscape/regenVariantPoll'),
              }));
              let mlResult: any[] = [];
              try {
                mlResult = await poll.done;
              } finally {
                soundPollRegistry.release(poll);
                _activeSoundJobIds.delete(generation_id);
                removeInflightJob(generation_id);
              }
              const s = mlResult[0];
              if (s) {
                patch = {
                  url: s.url,
                  duration: s.duration ?? target.duration,
                  geometry: s.geometry || target.geometry,
                  ...(s.noise_trim ? { noise_trim: s.noise_trim } : {}),
                  ...(s.volume_dbfs !== undefined ? { volume_dbfs: s.volume_dbfs } : {}),
                };
              }
            }

            if (!patch.url && !patch.duration) throw new Error('No audio returned');

            // Swap the audio payload IN PLACE. The event keeps the SAME id,
            // copy_index, position, geometry fallback and entity indices, so
            // DAW clip keys (soundId-iteration), iterationLinks, sound spheres
            // and linked entities all stay rooted to this variant.
            const updated = {
              ...target,
              ...patch,
              prompt,
              generated_signature: captureVariantSignature({ ...config, prompt }, { prompt }),
            };
            const nextData = (get().soundscapeData || []).map((s: any) =>
              s.id === target.id ? updated : s,
            );
            set(
              { generatedSounds: nextData, soundscapeData: nextData },
              false,
              'soundscape/regenVariantComplete',
            );
            applyTrimRegions([updated]);
            if (useAudioControlsStore.getState().selectedVariants[targetIndex] === variantIdx) {
              get().applyVariantGenerationSettings(targetIndex, target.id);
            }
          } catch (err: any) {
            if (err?.message !== 'AbortError') {
              const msg = `Regeneration failed: ${err?.message || err}`;
              set({ soundGenError: msg }, false, 'soundscape/regenVariantError');
              notifySectionError(msg);
            }
          } finally {
            endSoundGeneration();
            untrackGenerationTargets([targetIndex]);
            set(
              {
                soundGenProgress: '',
                soundGenProgressValue: 0,
                soundGenStatusText: '',
                regeneratingVariantIndices: get().regeneratingVariantIndices.filter((i) => i !== targetIndex),
              },
              false,
              'soundscape/regenVariantEnd',
            );
          }
        },

        handleStopGeneration: () => {
          // Stop every in-flight poll (each rejects its promise → the owning
          // invocation unwinds and cleans up its own state).
          soundPollRegistry.stopAll(new Error('AbortError'));

          for (const id of _activeSoundJobIds) {
            apiService.cancelSoundGeneration(id);
            removeInflightJob(id);
          }
          _activeSoundJobIds.clear();

          for (const id of _activeTtsJobIds) {
            apiService.cancelTTSGeneration(id);
            removeInflightJob(id);
          }
          _activeTtsJobIds.clear();

          orchestratePollRegistry.stopAll(new Error('AbortError'));
          for (const id of _activeOrchestrateJobIds) {
            apiService.cancelJob(id).catch(() => {});
            removeInflightJob(id);
          }
          _activeOrchestrateJobIds.clear();
          _orchestrateProgressStatus = null;

          for (const c of _abortControllers) {
            try { c.abort(); } catch {}
          }
          _abortControllers.clear();
          _invocations.clear();

          _activeCount = 0;
          _targetGlobal = false;
          _targetIndices.clear();

          set(
            {
              isSoundGenerating: false,
              soundGenTargetIndices: null,
              soundGenError: 'Sound generation stopped by user.',
              soundGenProgress: '',
              soundGenProgressValue: 0,
              soundGenStatusText: '',
              activeGenerationCardIndices: [],
              soundGenCardStatus: {},
              regeneratingIndices: [],
              regeneratingVariantIndices: [],
            },
            false,
            'soundscape/stop',
          );
        },

        handleStopGenerationFor: (targetIndices) => {
          const targets = new Set(targetIndices);
          for (const invocation of [..._invocations]) {
            if (invocation.refs.some((ref) => ref.current !== null && targets.has(ref.current))) {
              // The invocation unwinds itself (its finally clears its own cards).
              stopInvocation(invocation);
            }
          }
        },

        handleReprocessSounds: async (applyDenoising, trimSilence = false) => {
          const { soundscapeData } = get();
          if (!soundscapeData || soundscapeData.length === 0) return;

          try {
            const soundUrls = soundscapeData.map((s: any) => s.url);
            const response = await fetch(`${API_BASE_URL}/api/reprocess-sounds`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sound_urls: soundUrls, apply_denoising: applyDenoising, trim_silence: trimSilence }),
            });

            if (!response.ok) {
              const err = await response.json();
              throw new Error(err.detail || 'Failed to reprocess sounds');
            }

            const timestamp = Date.now();
            const updated = soundscapeData.map((s: any) => ({
              ...s,
              url: s.url.includes('?') ? `${s.url}&t=${timestamp}` : `${s.url}?t=${timestamp}`,
            }));
            set({ soundscapeData: updated }, false, 'soundscape/reprocessed');

            // Re-apply backend-detected trim regions (the files were rewritten by reprocessing,
            // so their noise boundaries may have shifted).
            const data = await response.json();
            const noiseTrims = data?.noise_trims;
            if (noiseTrims && typeof noiseTrims === 'object') {
              const trimEvents = Object.entries(noiseTrims).map(([url, nt]) => {
                const ev = soundscapeData.find((s: any) => s.url === url);
                return ev ? { id: ev.id, noise_trim: nt } : null;
              }).filter(Boolean);
              applyTrimRegions(trimEvents);
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Failed to reprocess sounds';
            set(
              { soundGenError: msg },
              false,
              'soundscape/reprocessError',
            );
            notifySectionError(msg);
          }
        },

        setActiveSoundConfigTab: (tab) =>
          set({ activeSoundConfigTab: tab }, false, 'soundscape/setTab'),

        setSoundConfigsFromPrompts: (prompts) => {
          const { soundConfigs, globalSteps, generatedSounds } = get();
          // The Advanced Settings "Diffusion Steps" value is the single source of
          // truth for inference steps. Configs arriving from LLM analysis / SED
          // carry a placeholder `steps` value, so stamp the current global value
          // here (the live-edit path is handleGlobalStepsChange).
          const stamped = prompts.map((p) => ({ ...p, steps: globalSteps }));
          const isSingleEmpty =
            soundConfigs.length === 1 &&
            !soundConfigs[0].prompt &&
            !soundConfigs[0].uploadedAudioUrl &&
            !soundConfigs[0].selectedLibrarySound;

          if (isSingleEmpty) {
            set(
              { soundConfigs: stamped.map((c) => ({ ...c, config_id: c.config_id || newConfigId() })) },
              false,
              'soundscape/setConfigsFromPrompts',
            );
            return;
          }

          // Is this card already generated? Identity first (config_id), index only
          // as a legacy fallback (events written before config_id existed).
          const hasEventsForConfig = (cfg: SoundGenerationConfig, idx: number): boolean =>
            generatedSounds.some((e: any) => {
              if (cfg.config_id && e.config_id) return e.config_id === cfg.config_id;
              return e.prompt_index === idx;
            });

          // Dedup + update: match by prompt text + display_name (display_name = soundName, deterministic)
          const updated = [...soundConfigs];
          const toAppend: any[] = [];
          // Old identities/indices whose events must be dropped when a card is reset.
          const staleConfigIds = new Set<string>();
          const staleIndexes = new Set<number>();
          let didUpdate = false;
          for (const newConfig of stamped) {
            const existingIdx = updated.findIndex((existing) => {
              const samePrompt =
                existing.prompt.trim().toLowerCase() ===
                newConfig.prompt.trim().toLowerCase();
              const sameDisplayName =
                (existing.display_name || '') === (newConfig.display_name || '');
              return samePrompt && sameDisplayName;
            });
            if (existingIdx >= 0) {
              const prev = updated[existingIdx];
              const isGenerated = hasEventsForConfig(soundConfigs[existingIdx], existingIdx);
              if (isGenerated) {
                // Sending an already-generated card to Sounds is a FRESH generation:
                // give it a new identity so it renders pending, and drop its old
                // events so the scene does not double up.
                if (prev.config_id) staleConfigIds.add(prev.config_id);
                staleIndexes.add(existingIdx);
              }
              updated[existingIdx] = {
                ...prev,
                // Fresh identity only when the previous card was generated.
                ...(isGenerated ? { config_id: newConfigId() } : {}),
                // Re-sending a scenario/analysis to Sounds is authoritative:
                // refresh the variant count and the pipeline linkage too, so a
                // card created before the count was known does not stay at 1.
                seed_copies: newConfig.seed_copies,
                scenarioSource: newConfig.scenarioSource,
                orchestrateMeta: newConfig.orchestrateMeta,
                dbfs: newConfig.dbfs,
                interval_seconds: newConfig.interval_seconds,
                timestamps: newConfig.timestamps,
                duration: newConfig.duration,
                category: newConfig.category,
                ...(newConfig.parentUsageOriginalIndex !== undefined
                  ? { parentUsageOriginalIndex: newConfig.parentUsageOriginalIndex }
                  : {}),
                // Only set position if this config doesn't already have one (first-load case)
                ...(!prev.position && newConfig.position
                  ? { position: newConfig.position }
                  : {}),
              };
              didUpdate = true;
            } else {
              toAppend.push({ ...newConfig, config_id: newConfig.config_id || newConfigId() });
            }
          }

          if (toAppend.length > 0 || didUpdate) {
            const dropStale = (e: any): boolean =>
              (!!e.config_id && staleConfigIds.has(e.config_id)) ||
              (!e.config_id && staleIndexes.has(e.prompt_index));
            const removedIds: string[] = [];
            const nextGenerated = generatedSounds.filter((e: any) => {
              if (dropStale(e)) {
                if (e.id) removedIds.push(e.id);
                return false;
              }
              return true;
            });
            const nextSoundscape = (get().soundscapeData ?? []).filter((e: any) => !dropStale(e));
            if (removedIds.length > 0) {
              useAudioControlsStore.getState().pruneSounds(removedIds);
            }
            set(
              {
                soundConfigs: [...updated, ...toAppend],
                generatedSounds: nextGenerated,
                soundscapeData: nextSoundscape.length > 0 ? nextSoundscape : null,
              },
              false,
              'soundscape/appendFromPrompts',
            );
          }
        },

        setSoundscapeData: (data) => {
          set(
            { soundscapeData: data, generatedSounds: data ?? [] },
            false,
            'soundscape/setSoundscapeData',
          );
        },

        setGlobalNegativePrompt: (val) =>
          set({ globalNegativePrompt: val }, false, 'soundscape/setNegPrompt'),

        setApplyDenoising: (val) =>
          set({ applyDenoising: val }, false, 'soundscape/setDenoising'),

        setTrimSilence: (val) =>
          set({ trimSilence: val }, false, 'soundscape/setTrimSilence'),

        setApplyNoiseReduction: (val) =>
          set({ applyNoiseReduction: val }, false, 'soundscape/setApplyNoiseReduction'),

        setAudioModel: (model) =>
          set({ audioModel: model }, false, 'soundscape/setModel'),

        setLlmModel: (model) =>
          set({ llmModel: normalizeLlmModel(model) }, false, 'soundscape/setLlmModel'),

        setTtsModel: (model) =>
          set({ ttsModel: normalizeTtsModel(model) }, false, 'soundscape/setTtsModel'),

        setOrchestrateSoundsEnabled: (val) =>
          set({ orchestrateSoundsEnabled: val }, false, 'soundscape/setOrchestrateSoundsEnabled'),

        reorchestrateTimeline: async (scenarioId) => {
          const { soundConfigs } = get();

          // Group the current (edited) scenario-source cards by scenario id.
          // When a scenario is given, re-run only that scenario (the active
          // Sounds step) and leave the others untouched.
          const scenarioGroups = new Map<string, SoundGenerationConfig[]>();
          soundConfigs.forEach((config) => {
            const src = config.scenarioSource;
            if (!src) return;
            if (scenarioId && src.scenarioId !== scenarioId) return;
            const arr = scenarioGroups.get(src.scenarioId) ?? [];
            arr.push(config);
            scenarioGroups.set(src.scenarioId, arr);
          });

          // Re-stamp links + re-bake helper (used by both branches below).
          const applyAndBake = (advanceBaseline: boolean) => {
            const audioStore = useAudioControlsStore.getState();
            const finalConfigs = get().soundConfigs;
            audioStore.syncSoundConfigs(finalConfigs);
            audioStore.syncGeneratedSounds(get().generatedSounds);
            audioStore.setOrchestrateIterationLinks(finalConfigs);
            // Capture the orchestrator result for "Reset track" once the bake applies.
            // `notify: true` — re-orchestrate is an authoritative orchestrator-job bake.
            audioStore.bakeOrchestrateSchedule(() => {
              useAudioControlsStore.getState().saveOrchestrateResult();
            }, { notify: true });
            if (advanceBaseline) {
              set(
                { orchestrateBaselineSignature: orchestrateInputsSignature(finalConfigs) },
                false,
                'soundscape/reorchestrateBaseline',
              );
            }
          };

          // No scenario source (e.g. a fully pre-orchestrated scene) — nothing to
          // send to the agent. Fall back to re-stamping links + re-baking.
          if (scenarioGroups.size === 0) {
            applyAndBake(true);
            return;
          }

          set(
            {
              isReorchestrating: true,
              isOrchestrating: true,
              orchestrateThinking: '',
              soundGenProgress: 'Orchestrating timeline…',
              soundGenProgressValue: 100,
            },
            false,
            'soundscape/reorchestrateStart',
          );
          const controller = new AbortController();
          try {
            const timings = buildEntryTimings(
              get().soundConfigs,
              get().generatedSounds,
              useAudioControlsStore.getState().soundBufferDurations,
              useAudioControlsStore.getState().soundTrims,
            );
            const { entryById, orchestrateIdByScenario } = await runOrchestrationForSources(
              scenarioGroups,
              controller.signal,
              // Same live status line as generation.
              (status) => {
                _orchestrateProgressStatus = status;
                set({ soundGenProgress: status }, false, 'soundscape/reorchestrateProgress');
              },
              timings,
              'reorchestrate',
              (thinking) => set({ orchestrateThinking: thinking }, false, 'soundscape/reorchestrateThinking'),
            );
            if (entryById.size > 0) {
              applyOrchestrateDynamics(entryById, orchestrateIdByScenario);
              // Only advance the baseline when the agent actually produced results,
              // so a failed run keeps the button visible for a retry.
              applyAndBake(true);
            } else {
              applyAndBake(false);
            }
          } catch (e) {
            console.warn('[soundscapeStore] re-orchestrate failed:', e);
            notifySectionError('Re-orchestration failed', 'error');
          } finally {
            set(
              (s) => ({
                isReorchestrating: false,
                // A scene's post-generation orchestration may still be running.
                isOrchestrating: s.orchestratingScenarioIds.length > 0,
                orchestrateThinking: '',
                soundGenProgress: '',
                soundGenProgressValue: 0,
              }),
              false,
              'soundscape/reorchestrateEnd',
            );
          }
        },
        handleUploadAudio: async (index, file) => {
          try {
            const result = await loadAudioFile(file);
            set(
              (s) => ({
                soundConfigs: s.soundConfigs.map((c, i) =>
                  i === index
                    ? {
                        ...c,
                        type: 'upload' as CardType,
                        uploadedAudioBuffer: result.audioBuffer,
                        uploadedAudioInfo: result.audioInfo,
                        uploadedAudioUrl: result.audioUrl,
                      }
                    : c,
                ),
              }),
              false,
              'soundscape/uploadAudio',
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Failed to upload audio';
            set(
              { soundGenError: msg },
              false,
              'soundscape/uploadAudioError',
            );
            notifySectionError(msg);
          }
        },

        handleClearUploadedAudio: (index) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          if (config?.uploadedAudioUrl) revokeAudioUrl(config.uploadedAudioUrl);
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? { ...c, uploadedAudioBuffer: undefined, uploadedAudioInfo: undefined, uploadedAudioUrl: undefined }
                  : c,
              ),
            }),
            false,
            'soundscape/clearUpload',
          );
        },

        rehydrateSampleAudioConfigs: async () => {
          // A sample-audio card's clip is the deterministic bundled sample, loaded
          // once at card creation. Its blob URL does not survive a refresh, so after
          // a soundscape restore any sample-audio config without a loaded clip
          // re-fetches the sample (keeps "Reset to configuration UI" working).
          const { soundConfigs } = get();
          const targets = soundConfigs
            .map((c, idx) => ({ c, idx }))
            .filter(
              ({ c, idx }) =>
                c.type === 'sample-audio' && idx >= 0 && !c.uploadedAudioUrl && !c.uploadedAudioInfo,
            );
          for (const { idx } of targets) {
            try {
              const sampleFile = await apiService.loadSampleAudio();
              const result = await loadAudioFile(sampleFile);
              const configId = get().soundConfigs[idx]?.config_id;
              const withSample = (configs: SoundGenerationConfig[], matchIndex: number | null) =>
                configs.map((c, i) =>
                  (configId ? c.config_id === configId : i === matchIndex) &&
                  c.type === 'sample-audio' &&
                  !c.uploadedAudioUrl
                    ? {
                        ...c,
                        uploadedAudioBuffer: result.audioBuffer,
                        uploadedAudioInfo: result.audioInfo,
                        uploadedAudioUrl: result.audioUrl,
                      }
                    : c,
                );
              // Reloading the bundled clip is a load, not an edit: no undo step,
              // and every history snapshot of this card gets the clip too.
              runWithoutUndo(() =>
                set((s) => ({ soundConfigs: withSample(s.soundConfigs, idx) }), false, 'soundscape/sampleRehydrate'),
              );
              rebaseUndoHistory<SoundscapeSnapshot>('soundscape', (snap) => ({
                ...snap,
                soundConfigs: withSample(snap.soundConfigs, configId ? null : idx),
              }));
            } catch (error) {
              console.warn(
                '[soundscapeStore] Failed to reload bundled sample for config',
                idx,
                error,
              );
            }
          }
        },

        handleLibrarySearch: async (index) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          const prompt = config?.prompt.trim();
          if (!prompt) return;

          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? {
                      ...c,
                      librarySearchState: {
                        isSearching: true,
                        results: [],
                        selectedSound: null,
                        error: null,
                      },
                    }
                  : c,
              ),
            }),
            false,
            'soundscape/librarySearchStart',
          );

          try {
            const response = await fetch(`${API_BASE_URL}/api/library/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, max_results: LIBRARY_MAX_SEARCH_RESULTS }),
            });
            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();
            set(
              (s) => ({
                soundConfigs: s.soundConfigs.map((c, i) =>
                  i === index
                    ? {
                        ...c,
                        librarySearchState: {
                          isSearching: false,
                          results: data.results || [],
                          selectedSound: null,
                          error: null,
                        },
                      }
                    : c,
                ),
              }),
              false,
              'soundscape/librarySearchDone',
            );
          } catch {
            set(
              (s) => ({
                soundConfigs: s.soundConfigs.map((c, i) =>
                  i === index
                    ? {
                        ...c,
                        librarySearchState: {
                          isSearching: false,
                          results: [],
                          selectedSound: null,
                          error: 'Search failed. Please try again.',
                        },
                      }
                    : c,
                ),
              }),
              false,
              'soundscape/librarySearchError',
            );
          }
        },

        handleLibrarySoundSelect: (index, sound) =>
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? {
                      ...c,
                      selectedLibrarySound: sound,
                      display_name: c.display_name || sound.description,
                      librarySearchState: c.librarySearchState
                        ? { ...c.librarySearchState, selectedSound: sound }
                        : undefined,
                    }
                  : c,
              ),
            }),
            false,
            'soundscape/librarySelect',
          ),

        handleCatalogSoundSelect: (index, sound) =>
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? { ...c, selectedCatalogSound: sound, display_name: sound.name }
                  : c,
              ),
            }),
            false,
            'soundscape/catalogSelect',
          ),

        clearOrchestrateTrigger: (configIndex, iterationIndex) => {
          const { soundConfigs } = get();
          const config = soundConfigs[configIndex];
          if (!config?.orchestrateMeta) return;
          const meta = config.orchestrateMeta;
          const newExpression = [...meta.trigger.expression];
          const newDelay = [...(meta.trigger.delay ?? [])];
          newExpression[iterationIndex] = '';
          newDelay[iterationIndex] = 0;
          const newMeta = {
            ...meta,
            trigger: { ...meta.trigger, expression: newExpression, delay: newDelay },
          };
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === configIndex ? { ...c, orchestrateMeta: newMeta } : c,
              ),
            }),
            false,
            'soundscape/clearOrchestrateTrigger',
          );
        },

        handleResetToDefaults: () =>
          set(
            (s) => ({
              globalDuration: DEFAULT_DURATION_SECONDS,
              globalSteps: DEFAULT_DIFFUSION_STEPS,
              globalNegativePrompt: 'distorted, reverb, echo, background noise, hall, spaciousness',
              applyDenoising: false,
              trimSilence: false,
              applyNoiseReduction: true,
              audioModel: DEFAULT_AUDIO_MODEL,
              llmModel: DEFAULT_LLM_MODEL,
              ttsModel: DEFAULT_TTS_MODEL,
              // Keep live configs in sync with the global sliders, matching
              // handleGlobalStepsChange / handleGlobalDurationChange.
              soundConfigs: s.soundConfigs.map((c) => ({
                ...c,
                duration: DEFAULT_DURATION_SECONDS,
                steps: DEFAULT_DIFFUSION_STEPS,
              })),
            }),
            false,
            'soundscape/resetDefaults',
          ),

        handleResetSoundConfig: (index) => {
          const { soundConfigs } = get();
          const config = soundConfigs[index];
          if (!config) return;
          // For upload / sample-audio cards the source clip IS the configuration —
          // "Reset to configuration UI" must keep it loaded so the card can be
          // re-run (or the audio edited via the ✕ button). Only non-clip card
          // types (which never own a blob here) drop the uploaded-audio fields.
          const keepsSourceClip = config.type === 'upload' || config.type === 'sample-audio';
          if (!keepsSourceClip && config.uploadedAudioUrl) {
            try { URL.revokeObjectURL(config.uploadedAudioUrl); } catch {}
          }
          set(
            (s) => ({
              soundConfigs: s.soundConfigs.map((c, i) =>
                i === index
                  ? {
                      ...c,
                      display_name: undefined,
                      uploadedAudioBuffer: keepsSourceClip ? c.uploadedAudioBuffer : undefined,
                      uploadedAudioInfo: keepsSourceClip ? c.uploadedAudioInfo : undefined,
                      uploadedAudioUrl: keepsSourceClip ? c.uploadedAudioUrl : undefined,
                      selectedLibrarySound: undefined,
                      librarySearchState: undefined,
                      selectedCatalogSound: undefined,
                    }
                  : c,
              ),
            }),
            false,
            'soundscape/resetSoundConfig',
          );
        },

        handleDuplicateConfig: (index) => {
          const { soundConfigs, soundscapeData } = get();
          const config = soundConfigs[index];
          if (!config) return;

          const newConfig: SoundGenerationConfig = {
            ...config,
            config_id: newConfigId(),
            display_name: config.display_name ? `${config.display_name} (copy)` : undefined,
            entities: undefined,
          };

          const newPromptIndex = soundConfigs.length;
          const newConfigs = [...soundConfigs, newConfig];

          let newSoundscape = soundscapeData;
          if (soundscapeData) {
            const origEvents = soundscapeData.filter((s: any) => s.prompt_index === index);
            if (origEvents.length > 0) {
              const duped = origEvents.map((event: any, vIdx: number) => ({
                ...event,
                id: `duplicate-${newConfig.config_id}-${vIdx}`,
                prompt_index: newPromptIndex,
                config_id: newConfig.config_id,
                position: [
                  (event.position as [number, number, number])[0] + DUPLICATE_POSITION_OFFSET,
                  (event.position as [number, number, number])[1],
                  (event.position as [number, number, number])[2],
                ] as [number, number, number],
                display_name: newConfig.display_name || event.display_name,
                entity_index: undefined,
              }));
              newSoundscape = [...soundscapeData, ...duped];
            }
          }

          set(
            {
              soundConfigs: newConfigs,
              activeSoundConfigTab: newPromptIndex,
              soundscapeData: newSoundscape,
              generatedSounds: newSoundscape ?? [],
            },
            false,
            'soundscape/duplicateConfig',
          );
        },

        handleDeleteVariant: async (promptIndex, variantIdx) => {
          const { soundscapeData } = get();
          if (!soundscapeData) return;

          // Order variants by their variant index. Regular generated/TTS events
          // carry `copy_index`; injected SED-extracted segments instead store
          // their segment index in `total_copies` (see injectExtractedSEDSounds)
          // and have no trailing numeric in their id to fall back on.
          const variantIndexFor = (s: any): number => {
            if (s.copy_index !== undefined) return Number(s.copy_index);
            if (String(s.id ?? '').startsWith('sed-') && s.total_copies !== undefined) {
              return Number(s.total_copies);
            }
            const trailing = /(\d+)$/.exec(String(s.id ?? ''));
            return trailing ? Number(trailing[1]) : 0;
          };

          const variants = soundscapeData
            .filter((s: any) => s.prompt_index === promptIndex)
            .sort((a: any, b: any) => variantIndexFor(a) - variantIndexFor(b));

          if (variants.length <= 1 || variantIdx < 0 || variantIdx >= variants.length) return;

          const target = variants[variantIdx];
          const newData = soundscapeData.filter((s: any) => s !== target);

          // Adjust selected variant index if needed
          const audioStore = useAudioControlsStore.getState();
          const currentSelected = audioStore.selectedVariants[promptIndex] ?? 0;
          if (currentSelected >= variantIdx && currentSelected > 0) {
            audioStore.handleVariantChange(promptIndex, currentSelected - 1);
          }

          set(
            { soundscapeData: newData, generatedSounds: newData },
            false,
            'soundscape/deleteVariant',
          );

          // Keep the orchestrator's per-iteration variant array consistent with the
          // reduced variant set: references to the deleted variant fall back to A,
          // later references shift down, and seed_copies tracks the new count.
          // Without this, the bake/iterationLinks would keep pointing at a variant
          // that no longer exists (the deleted variant kept reappearing in the DAW).
          const config = get().soundConfigs[promptIndex];
          if (config?.orchestrateMeta) {
            const deletedOneBased = variantIdx + 1;
            const newVariants = config.orchestrateMeta.variants.map((v) =>
              v === deletedOneBased ? 1 : v > deletedOneBased ? v - 1 : v,
            );
            get().handleUpdateConfig(promptIndex, 'orchestrateMeta', {
              ...config.orchestrateMeta,
              variants: newVariants,
            });
            get().handleUpdateConfig(promptIndex, 'seed_copies', Math.max(1, variants.length - 1));
            // Deleting a variant is not a settings edit — re-baseline the snapshot.
            const updated = get().soundConfigs[promptIndex];
            if (updated?.generatedSignature !== undefined) {
              get().handleUpdateConfig(promptIndex, 'generatedSignature', captureGenerationSignature(updated).generatedSignature);
            }
          }

          // The selection may have moved to another variant — show its settings.
          const remaining = variants.filter((v: any) => v !== target);
          const nowSelected = remaining[useAudioControlsStore.getState().selectedVariants[promptIndex] ?? 0];
          if (nowSelected?.id) get().applyVariantGenerationSettings(promptIndex, nowSelected.id);

          // Re-sync the audio store and re-bake so the deleted variant leaves the
          // timeline and no orphaned per-sound state survives.
          audioStore.syncSoundConfigs(get().soundConfigs);
          audioStore.syncGeneratedSounds(newData);
          audioStore.pruneSounds([target.id]);
          if (get().soundConfigs.some((c) => c.orchestrateMeta)) {
            audioStore.setOrchestrateIterationLinks(get().soundConfigs);
            audioStore.bakeOrchestrateSchedule();
          }

          // SED-extracted segment variants reference a real WAV on the backend
          // (unlike ML/TTS variants, whose files are intentionally kept on disk
          // for dedup/regeneration). Remove the file too so a deleted segment
          // does not linger and reappear after a refresh — but only once the
          // deletion can no longer be undone (an undo must get its audio back).
          if (
            String(target.id ?? '').startsWith('sed-') &&
            target.url &&
            !target.url.startsWith('blob:')
          ) {
            const url: string = target.url;
            scheduleUndoSafeDeletion(`sed:${url}`, {
              isReferenced: () => {
                const s = get();
                return [...(s.soundscapeData ?? []), ...s.generatedSounds].some((e: any) => e?.url === url);
              },
              run: () => apiService.deleteSedSegmentAudio(url),
            });
          }
        },

        duplicateConfigAt: (from, toInsertion) => {
          const { soundConfigs, soundscapeData, activeSoundConfigTab } = get();
          const config = soundConfigs[from];
          if (!config) return;

          const newConfig: SoundGenerationConfig = {
            ...config,
            config_id: newConfigId(),
            display_name: config.display_name ? `${config.display_name} (copy)` : undefined,
            entities: config.entities ? [...config.entities] : undefined,
          };

          const newConfigs = [...soundConfigs];
          const insertAt = toInsertion > from ? toInsertion - 1 : toInsertion;
          newConfigs.splice(insertAt, 0, newConfig);
          remapGenerationIndices(createInsertionIndexMapper(insertAt));

          // Remap active tab
          let newTab: number;
          if (activeSoundConfigTab === from) {
            newTab = insertAt;
          } else if (activeSoundConfigTab >= insertAt) {
            newTab = activeSoundConfigTab + 1;
          } else {
            newTab = activeSoundConfigTab;
          }

          // Duplicate linked soundscape events and remap prompt_index values
          let newSoundscape = soundscapeData;
          if (soundscapeData) {
            // Shift prompt_index for events that come after the insertion point
            const shifted = soundscapeData.map((event: any) => {
              if (event.prompt_index >= insertAt) {
                return { ...event, prompt_index: event.prompt_index + 1 };
              }
              return event;
            });

            // Duplicate events from the source card
            const origEvents = soundscapeData.filter((s: any) => s.prompt_index === from);
            if (origEvents.length > 0) {
              const duped = origEvents.map((event: any, vIdx: number) => ({
                ...event,
                id: `duplicate-${newConfig.config_id}-${vIdx}`,
                prompt_index: insertAt,
                config_id: newConfig.config_id,
                position: [
                  (event.position as [number, number, number])[0] + DUPLICATE_POSITION_OFFSET,
                  (event.position as [number, number, number])[1],
                  (event.position as [number, number, number])[2],
                ] as [number, number, number],
                display_name: newConfig.display_name || event.display_name,
              }));
              newSoundscape = [...shifted, ...duped];
            } else {
              newSoundscape = shifted;
            }
          }

          set(
            {
              soundConfigs: newConfigs,
              activeSoundConfigTab: newTab,
              soundscapeData: newSoundscape,
              generatedSounds: newSoundscape ?? [],
            },
            false,
            'soundscape/duplicateConfigAt',
          );
        },

        handleDetachSoundFromEntity: (index) => {
          const { soundConfigs, soundscapeData, generatedSounds } = get();

          // Remove the Speckle highlight for every object linked to this card.
          // objectSoundLinks maps objectId → card index, so match by card (covers
          // encoded prompt indices too) — no appId mapping needed.
          import('./speckleStore')
            .then(({ useSpeckleStore }) => {
              const { objectSoundLinks, unlinkObjectFromSound } = useSpeckleStore.getState();
              objectSoundLinks.forEach((linkedCardIdx, objectId) => {
                if (linkedCardIdx === index) unlinkObjectFromSound(objectId);
              });
            })
            .catch(() => { /* store not ready — non-critical */ });

          const newConfigs = soundConfigs.map((c, i) =>
            i === index ? { ...c, entities: undefined } : c,
          );
          // Detach ALL variants of the card (not just exact prompt_index matches).
          const detach = (sounds: any[]) =>
            sounds.map((s) => {
              if (!promptMatchesCard(s.prompt_index, index)) return s;
              const { entity_index, entity_indices, ...rest } = s;
              return rest;
            });
          set(
            {
              soundConfigs: newConfigs,
              soundscapeData: soundscapeData ? detach(soundscapeData) : null,
              generatedSounds: detach(generatedSounds),
            },
            false,
            'soundscape/detachEntity',
          );
        },

        handleAttachSoundToEntity: (index, entity, append = false) => {
          const { soundConfigs, soundscapeData, generatedSounds } = get();
          const currentConfig = soundConfigs[index];
          const newEntities = append
            ? [...(currentConfig?.entities || []), entity]
            : [entity];
          const newConfigs = soundConfigs.map((c, i) =>
            i === index ? { ...c, entities: newEntities } : c,
          );
          const primaryEntity = newEntities[0];
          const entityPosition: [number, number, number] = primaryEntity.bounds?.center
            ? [
                primaryEntity.bounds.center[0],
                primaryEntity.bounds.center[1],
                primaryEntity.bounds.center[2],
              ]
            : primaryEntity.position?.length >= 3
              ? [primaryEntity.position[0], primaryEntity.position[1], primaryEntity.position[2]]
              : [0, 0, 0];
          const entityIndices = newEntities
            .map((e: any) => e.index)
            .filter((i: any) => i !== undefined);

          const attach = (sounds: any[]) =>
            sounds.map((s) =>
              promptMatchesCard(s.prompt_index, index)
                ? { ...s, entity_index: primaryEntity.index, entity_indices: entityIndices, position: entityPosition }
                : s,
            );
          set(
            {
              soundConfigs: newConfigs,
              soundscapeData: soundscapeData ? attach(soundscapeData) : null,
              generatedSounds: attach(generatedSounds),
            },
            false,
            'soundscape/attachEntity',
          );
        },

        updateSoundPosition: (soundId, position) => {
          const { soundscapeData, generatedSounds } = get();
          const existing = soundscapeData?.find((s) => s.id === soundId);
          const promptIndex = existing?.prompt_index;
          if (
            existing?.position &&
            existing.position[0] === position[0] &&
            existing.position[1] === position[1] &&
            existing.position[2] === position[2]
          ) {
            return; // no-op
          }
          const update = (sounds: any[]) =>
            sounds.map((s) => {
              if (promptIndex !== undefined && s.prompt_index === promptIndex) {
                return { ...s, position };
              }
              if (promptIndex === undefined && s.id === soundId) {
                return { ...s, position };
              }
              return s;
            });
          set(
            {
              soundscapeData: soundscapeData ? update(soundscapeData) : null,
              generatedSounds: update(generatedSounds),
            },
            false,
            'soundscape/updatePosition',
          );
        },

        patchSoundEvent: (soundId, patch) => {
          const { soundscapeData, generatedSounds } = get();
          const update = (sounds: SoundEvent[]) =>
            sounds.map((s) => (s.id === soundId ? { ...s, ...patch } : s));
          set(
            {
              soundscapeData: soundscapeData ? update(soundscapeData) : null,
              generatedSounds: update(generatedSounds),
            },
            false,
            'soundscape/patchSoundEvent',
          );
        },

        selectLinkedEntity: (soundId, entityIndex, position) => {
          const { soundscapeData, generatedSounds } = get();
          const existing = soundscapeData?.find((s) => s.id === soundId);
          const promptIndex = existing?.prompt_index;
          // Entity link is card-level: update every variant of the card, including
          // speech lines encoded as cardIndex * 10000 + lineIdx.
          const cardIndex = promptIndex !== undefined && promptIndex >= 10000
            ? Math.floor(promptIndex / 10000)
            : promptIndex;
          const update = (sounds: any[]) =>
            sounds.map((s) => {
              if (cardIndex !== undefined && promptMatchesCard(s.prompt_index, cardIndex)) {
                return { ...s, position, entity_index: entityIndex };
              }
              if (cardIndex === undefined && s.id === soundId) {
                return { ...s, position, entity_index: entityIndex };
              }
              return s;
            });
          set(
            {
              soundscapeData: soundscapeData ? update(soundscapeData) : null,
              generatedSounds: update(generatedSounds),
            },
            false,
            'soundscape/selectLinkedEntity',
          );
        },

        restoreSoundscape: (configs, events, settings) => {
          set(
            {
              soundConfigs: configs,
              soundscapeData: events.length > 0 ? events : null,
              generatedSounds: events,
              activeSoundConfigTab: 0,
              ...(settings?.duration !== undefined && { globalDuration: settings.duration }),
              ...(settings?.steps !== undefined && { globalSteps: settings.steps }),
              ...(settings?.negativePrompt !== undefined && {
                globalNegativePrompt: settings.negativePrompt,
              }),
              ...(settings?.audioModel !== undefined && { audioModel: settings.audioModel }),
              ...(settings?.llmModel !== undefined && {
                llmModel: normalizeLlmModel(settings.llmModel),
              }),
              ...(settings?.ttsModel !== undefined && {
                ttsModel: normalizeTtsModel(settings.ttsModel),
              }),
              ...(settings?.orchestrateSoundsEnabled !== undefined && {
                orchestrateSoundsEnabled: settings.orchestrateSoundsEnabled,
              }),
              // Restored scene is already orchestrated — its editing baseline is
              // the inputs as loaded, so the re-orchestrate button starts hidden.
              orchestrateBaselineSignature: orchestrateInputsSignature(configs),
            },
            false,
            'soundscape/restore',
          );
        },

        injectExtractedSEDSounds: (sounds, parentUsageOriginalIndex) => {
          const { soundConfigs, generatedSounds, soundscapeData, globalDuration, globalSteps } = get();

          // Dedup: match by name (prompt) + parentUsageOriginalIndex, update if found
          const isSingleEmpty =
            soundConfigs.length === 1 &&
            !soundConfigs[0].prompt &&
            !soundConfigs[0].uploadedAudioUrl &&
            !soundConfigs[0].selectedLibrarySound;

          let updatedConfigs = isSingleEmpty ? [] : [...soundConfigs];
          const existingEvents = soundscapeData ? [...soundscapeData] : [...generatedSounds];
          const toAppendConfigs: SoundGenerationConfig[] = [];
          const toAppendEvents: any[] = [];

          sounds.forEach((s) => {
            const existingIdx = updatedConfigs.findIndex(
              (c) =>
                c.prompt.trim().toLowerCase() === s.name.trim().toLowerCase() &&
                c.parentUsageOriginalIndex === parentUsageOriginalIndex,
            );

            if (existingIdx >= 0) {
              // Update metadata only — preserve generation state
              updatedConfigs[existingIdx] = {
                ...updatedConfigs[existingIdx],
                dbfs: s.dbfs ?? updatedConfigs[existingIdx].dbfs,
                interval_seconds: s.interval_seconds ?? updatedConfigs[existingIdx].interval_seconds,
              };
              // Update variant URLs in existing events
              s.variants.forEach((v, vi) => {
                const evIdx = existingEvents.findIndex(
                  (e) => e.prompt_index === existingIdx && e.total_copies === vi,
                );
                if (evIdx >= 0) {
                  existingEvents[evIdx] = { ...existingEvents[evIdx], url: v.url };
                }
              });
            } else {
              const promptIndex = updatedConfigs.length + toAppendConfigs.length;
              const sedConfigId = newConfigId();
              toAppendConfigs.push({
                config_id: sedConfigId,
                prompt: s.name,
                duration: s.variants[0]?.duration ?? globalDuration,
                guidance_scale: undefined,
                negative_prompt: '',
                seed_copies: 1,
                steps: globalSteps,
                type: 'upload' as import('@/types').CardType,
                display_name: s.name,
                dbfs: s.dbfs,
                interval_seconds: s.interval_seconds,
                parentUsageOriginalIndex,
              });
              s.variants.forEach((v, vi) => {
                toAppendEvents.push({
                  id: `sed-${sedConfigId}-${vi}`,
                  url: v.url,
                  position: [0, 0, 0] as [number, number, number],
                  geometry: { vertices: [], faces: [] },
                  display_name: s.variants.length > 1 ? `${s.name}_${vi + 1}` : s.name,
                  prompt: s.name,
                  prompt_index: promptIndex,
                  config_id: sedConfigId,
                  total_copies: vi,
                  volume_dbfs: s.dbfs ?? DEFAULT_DBFS,
                  interval_seconds: s.interval_seconds ?? 30,
                  isUploaded: true,
                });
              });
            }
          });

          const allConfigs = [...updatedConfigs, ...toAppendConfigs];
          const allEvents = [...existingEvents, ...toAppendEvents];
          set(
            {
              soundConfigs: allConfigs,
              generatedSounds: allEvents,
              soundscapeData: allEvents.length > 0 ? allEvents : null,
            },
            false,
            'soundscape/injectSEDSounds',
          );
        },
      }),
      { name: 'soundscapeStore' },
    ),
    { partialize: soundscapePartialize, equality: soundscapeEquality, limit: UNDO_HISTORY_LIMIT },
  ),
);
