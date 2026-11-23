/**
 * Scene edit chat — runs one chat turn per scene:
 *   snapshot → edit agent (POST /api/scene-edit) → apply ops (one undo step)
 *   → generate the audio the ops need → re-orchestrate the scene with the request
 *   → assistant reply in the scene's thread.
 *
 * Like sceneWorkflowStore it only sequences existing store actions. Turns are keyed
 * by the scene's `scene_id` (stable across reorder / removal of other cards); the
 * thread itself lives on the scene card (analysisStore.setSceneChat) and is saved
 * with the soundscape. Runtime state here is not persisted.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { startPolling, type PollController } from '@/lib/poll-until-done';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import type {
  SceneChatMessage,
  SceneEditPhase,
  SceneEditRefMap,
  SceneEditResult,
  SceneEditTurn,
} from '@/types/sceneEdit';
import type { ScenarioConfig } from '@/types/analysis';
import { DEFAULT_LLM_MODEL, SCENE_EDIT } from '@/utils/constants';
import { newConfigId } from '@/utils/config-id';
import { captureGenerationSignature } from '@/utils/generationSignature';
import { MS_PER_SECOND } from '@/utils/sceneWorkflow';
import { applySceneEditOps } from '@/utils/sceneEdit/apply';
import type { SceneEditApplyContext } from '@/utils/sceneEdit/applyContext';
import { cardEvents, cardIndexByConfigId, cardSpeechLines } from '@/utils/sceneEdit/sceneCards';
import { buildSceneEditSnapshot } from '@/utils/sceneEdit/snapshot';
import { useAnalysisStore } from './analysisStore';
import { useAudioControlsStore } from './audioControlsStore';
import { useSoundscapeStore } from './soundscapeStore';
import { useSceneWorkflowStore } from './sceneWorkflowStore';
import { notifySectionError } from './errorsStore';

const KIND = 'scene_edit';

/** Index of the scene card with `sceneId`, or -1. */
export function sceneIndexById(sceneId: string): number {
  return useAnalysisStore.getState().analysisConfigs.findIndex((c) => c.scene_id === sceneId);
}

function sceneById(sceneId: string): ScenarioConfig | null {
  const cfg = useAnalysisStore.getState().analysisConfigs[sceneIndexById(sceneId)];
  return cfg?.type === 'scenario' ? cfg : null;
}

function chatOf(sceneId: string): SceneChatMessage[] {
  return sceneById(sceneId)?.editChat ?? [];
}

function writeChat(sceneId: string, messages: SceneChatMessage[]): void {
  const index = sceneIndexById(sceneId);
  if (index < 0) return;
  useAnalysisStore.getState().setSceneChat(index, messages.slice(-SCENE_EDIT.HISTORY_SAVE_MAX));
}

function patchMessage(sceneId: string, id: string, patch: Partial<SceneChatMessage>): void {
  writeChat(sceneId, chatOf(sceneId).map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

class TurnCancelled extends Error {}

/** Poll controllers of running turns, by scene id (cancel stops them). */
const _polls = new Map<string, { controller: PollController; jobId: string }>();
const _cancelled = new Set<string>();

export interface SceneEditStoreState {
  /** Running turn per scene id. */
  turns: Record<string, SceneEditTurn>;
  /** Send a message to scene `usageIndex`'s chat and run the turn. */
  sendTurn: (usageIndex: number, text: string) => void;
  /** Stop the scene's planning step (applied edits stay; Ctrl+Z undoes them). */
  cancelTurn: (sceneId: string) => void;
  /** Job recovery: finish a turn whose plan job survived a page refresh. */
  recoverTurn: (jobId: string, sceneId: string, completedResult?: unknown) => void;
}

export const useSceneEditStore = create<SceneEditStoreState>()(
  devtools(
    (set, get) => {
      const setTurn = (sceneId: string, patch: Partial<SceneEditTurn> | null) =>
        set(
          (s) => {
            if (patch === null) {
              const { [sceneId]: _gone, ...rest } = s.turns;
              return { turns: rest };
            }
            const prev = s.turns[sceneId];
            if (!prev && !patch.turnId) return s;
            return { turns: { ...s.turns, [sceneId]: { ...(prev as SceneEditTurn), ...patch } } };
          },
          false,
          'sceneEdit/turn',
        );

      const setPhase = (sceneId: string, phase: SceneEditPhase, status?: string) =>
        setTurn(sceneId, { phase, status: status ?? SCENE_EDIT.PHASE_LABELS[phase], thinking: '' });

      /** Poll the plan job to completion; the turn's thinking line follows it. */
      async function pollPlan(sceneId: string, jobId: string): Promise<SceneEditResult> {
        const controller = startPolling({
          fetchStatus: () => apiService.getJobStatus('llm', jobId),
          onStatus: (s) => {
            setTurn(sceneId, {
              thinking: typeof s.partial?.thinking === 'string' ? s.partial.thinking : '',
              status: s.status || SCENE_EDIT.PHASE_LABELS.planning,
            });
          },
        });
        _polls.set(sceneId, { controller, jobId });
        try {
          return (await controller.done) as SceneEditResult;
        } finally {
          _polls.delete(sceneId);
          removeInflightJob(jobId);
        }
      }

      /** Generate the audio the ops queued, all lanes at once. */
      async function runRegen(ctx: SceneEditApplyContext): Promise<void> {
        const sound = useSoundscapeStore.getState();
        const indices = (ids: Iterable<string>) => [...ids].map(cardIndexByConfigId).filter((i) => i >= 0);
        const lanes: Promise<unknown>[] = [];

        const fresh = indices(ctx.regen.generateNew);
        if (fresh.length) lanes.push(sound.handleGenerateFiltered(fresh, { skipOrchestrate: true }));
        const forced = indices(ctx.regen.force);
        if (forced.length) lanes.push(sound.handleGenerateInternal(forced, { force: true, skipOrchestrate: true }));

        ctx.regen.addCopies.forEach((extra, configId) => {
          lanes.push((async () => {
            for (let k = 0; k < extra; k += 1) {
              const i = cardIndexByConfigId(configId);
              if (i < 0) return;
              await useSoundscapeStore.getState().handleRegenerateSingle(i);
            }
            // "+" never raises seed_copies; the card's copy count follows the new variants.
            const i = cardIndexByConfigId(configId);
            const config = useSoundscapeStore.getState().soundConfigs[i];
            if (i < 0 || !config) return;
            const updated = { ...config, seed_copies: Math.max(1, cardEvents(i).length) };
            const { handleUpdateConfig } = useSoundscapeStore.getState();
            handleUpdateConfig(i, 'seed_copies', updated.seed_copies);
            if (config.generatedSignature !== undefined) {
              handleUpdateConfig(i, 'generatedSignature', captureGenerationSignature(updated).generatedSignature);
            }
          })());
        });

        ctx.regen.inPlaceLines.forEach((lineIndices, configId) => {
          lanes.push((async () => {
            for (const line of lineIndices) {
              const i = cardIndexByConfigId(configId);
              const config = useSoundscapeStore.getState().soundConfigs[i];
              if (i < 0 || !config) return;
              await useSoundscapeStore.getState().regenerateVariantInPlace(i, line, cardSpeechLines(config)[line]);
            }
          })());
        });

        await Promise.allSettled(lanes);
      }

      function countAudioJobs(ctx: SceneEditApplyContext): number {
        let n = ctx.regen.generateNew.size + ctx.regen.force.size;
        ctx.regen.addCopies.forEach((k) => { n += k; });
        ctx.regen.inPlaceLines.forEach((lines) => { n += lines.length; });
        return n;
      }

      /** Apply a plan, generate, re-orchestrate, and write the assistant reply. */
      async function finishTurn(
        sceneId: string,
        replyId: string,
        instruction: string,
        result: SceneEditResult,
        refMap: SceneEditRefMap,
        names: Record<string, string>,
      ): Promise<void> {
        const usageIndex = sceneIndexById(sceneId);
        const sc = sceneById(sceneId);
        if (usageIndex < 0 || !sc) return;
        setPhase(sceneId, 'applying');
        const ctx = applySceneEditOps(
          usageIndex,
          result.ops ?? [],
          refMap,
          names,
          sc.timelineDurationMs / MS_PER_SECOND,
        );
        const warnings = [...(result.warnings ?? []), ...ctx.warnings];
        patchMessage(sceneId, replyId, {
          text: result.reply || (ctx.labels.length ? '' : SCENE_EDIT.NO_CHANGES),
          changes: ctx.labels,
          warnings,
        });

        const jobs = countAudioJobs(ctx);
        if (jobs > 0) {
          setPhase(sceneId, 'generating', `Generating ${jobs} sound${jobs === 1 ? '' : 's'}…`);
          await runRegen(ctx);
        }
        const scenarioId = sceneById(sceneId)?.scenarioId;
        if (ctx.needsOrchestrate && scenarioId) {
          setPhase(sceneId, 'orchestrating');
          await useSoundscapeStore.getState().reorchestrateTimeline(scenarioId, { instruction });
        }
        const failedOps = (result.ops?.length ?? 0) - ctx.labels.length;
        patchMessage(sceneId, replyId, {
          status: failedOps > 0 && ctx.labels.length > 0 ? 'partial' : 'applied',
        });
      }

      async function runTurn(sceneId: string, text: string, replyId: string): Promise<void> {
        const usageIndex = sceneIndexById(sceneId);
        const sc = sceneById(sceneId);
        if (usageIndex < 0 || !sc) return;
        const built = buildSceneEditSnapshot(usageIndex, useAudioControlsStore.getState().ttsLanguage);
        if (!built) throw new Error(SCENE_EDIT.NOT_READY);
        const names = Object.fromEntries(built.snapshot.cards.map((c) => [c.ref, c.name]));
        const history = chatOf(sceneId)
          .filter((m) => m.id !== replyId && m.text)
          .slice(-SCENE_EDIT.HISTORY_SEND_MAX - 1, -1)
          .map((m) => ({ role: m.role, text: m.text }));

        const { job_id } = await apiService.enqueueSceneEdit({
          instruction: text,
          snapshot: built.snapshot,
          history,
          llm_model: sc.llmModel ?? DEFAULT_LLM_MODEL,
        });
        if (_cancelled.has(sceneId)) {
          apiService.cancelJob(job_id).catch(() => {});
          throw new TurnCancelled();
        }
        recordInflightJob(job_id, 'llm', { kind: KIND, configId: sceneId, configIndex: usageIndex });
        setTurn(sceneId, { jobId: job_id });
        const result = await pollPlan(sceneId, job_id);
        if (_cancelled.has(sceneId)) throw new TurnCancelled();
        await finishTurn(sceneId, replyId, text, result, built.refMap, names);
      }

      /** Run `work` as the scene's turn, turning failures into the reply's status. */
      async function guarded(sceneId: string, replyId: string, work: () => Promise<void>): Promise<void> {
        try {
          await work();
        } catch (err) {
          if (err instanceof TurnCancelled || _cancelled.has(sceneId)) {
            patchMessage(sceneId, replyId, { status: 'cancelled', text: 'Stopped.' });
          } else {
            const message = err instanceof Error ? err.message : SCENE_EDIT.FAILED;
            patchMessage(sceneId, replyId, { status: 'failed', text: message });
            notifySectionError(`${SCENE_EDIT.FAILED}: ${message}`);
          }
        } finally {
          _cancelled.delete(sceneId);
          setTurn(sceneId, null);
        }
      }

      return {
        turns: {},

        sendTurn: (usageIndex, rawText) => {
          const text = rawText.trim().slice(0, SCENE_EDIT.MESSAGE_MAX_CHARS);
          const sc = useAnalysisStore.getState().analysisConfigs[usageIndex];
          const sceneId = sc?.type === 'scenario' ? sc.scene_id : undefined;
          if (!text || !sceneId || get().turns[sceneId]) return;
          if (useSceneWorkflowStore.getState().runs[usageIndex]?.status === 'running') return;

          const now = Date.now();
          const replyId = newConfigId();
          writeChat(sceneId, [
            ...chatOf(sceneId),
            { id: newConfigId(), role: 'user', text, createdAt: now },
            { id: replyId, role: 'assistant', text: '', createdAt: now, status: 'pending' },
          ]);
          setTurn(sceneId, {
            turnId: replyId,
            phase: 'planning',
            jobId: null,
            thinking: '',
            status: SCENE_EDIT.PHASE_LABELS.planning,
          });
          void guarded(sceneId, replyId, () => runTurn(sceneId, text, replyId));
        },

        cancelTurn: (sceneId) => {
          const turn = get().turns[sceneId];
          if (!turn) return;
          // Only the planning step is stoppable; once ops apply the turn runs to its end.
          if (turn.phase !== 'planning') return;
          _cancelled.add(sceneId);
          const poll = _polls.get(sceneId);
          if (poll) {
            poll.controller.stop(new TurnCancelled());
            apiService.cancelJob(poll.jobId).catch(() => {});
          }
        },

        recoverTurn: (jobId, sceneId, completedResult) => {
          const usageIndex = sceneIndexById(sceneId);
          if (usageIndex < 0 || get().turns[sceneId]) {
            removeInflightJob(jobId);
            return;
          }
          const pending = [...chatOf(sceneId)].reverse().find((m) => m.role === 'assistant' && m.status === 'pending');
          const instruction = [...chatOf(sceneId)].reverse().find((m) => m.role === 'user')?.text ?? '';
          if (!pending) {
            removeInflightJob(jobId);
            return;
          }
          // Refs are rebuilt from the scene as it is now: same cards → same refs.
          const built = buildSceneEditSnapshot(usageIndex, useAudioControlsStore.getState().ttsLanguage);
          if (!built) return;
          const names = Object.fromEntries(built.snapshot.cards.map((c) => [c.ref, c.name]));
          setTurn(sceneId, { turnId: pending.id, phase: 'planning', jobId, thinking: '', status: SCENE_EDIT.PHASE_LABELS.planning });
          void guarded(sceneId, pending.id, async () => {
            const result = completedResult
              ? (completedResult as SceneEditResult)
              : await pollPlan(sceneId, jobId);
            if (completedResult) removeInflightJob(jobId);
            await finishTurn(sceneId, pending.id, instruction, result, built.refMap, names);
          });
        },
      };
    },
    { name: 'sceneEditStore' },
  ),
);

/** Job recovery entry (hooks/useJobRecovery.ts). */
export function recoverSceneEditJob(jobId: string, sceneId: string | undefined, completedResult?: unknown): void {
  if (!sceneId) {
    removeInflightJob(jobId);
    return;
  }
  useSceneEditStore.getState().recoverTurn(jobId, sceneId, completedResult);
}

export const SCENE_EDIT_JOB_KIND = KIND;
