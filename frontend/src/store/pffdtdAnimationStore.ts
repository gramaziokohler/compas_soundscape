/**
 * PFFDTD Animation Store
 *
 * On-demand wave animations of finished wave-based runs, keyed by simulation
 * id: submit (POST /api/pffdtd/animation), poll the unified job, cancel. When
 * a job finishes, the simulation's field data is reloaded from the results
 * JSON (`pffdtdVisualsStore.reloadField`), which then carries the new plane
 * and its frames. Not persisted and not undoable: a refresh only loses the
 * progress display — the finished animation lands in the results JSON anyway.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { PFFDTD } from '@/utils/constants';
import { usePffdtdVisualsStore } from './pffdtdVisualsStore';

export interface PffdtdAnimationJob {
  status: 'running' | 'error';
  progress: number;
  statusText: string;
  error: string | null;
  jobId: string | null;
}

export interface PffdtdAnimationStoreState {
  jobs: Record<string, PffdtdAnimationJob>;
  /** Animate every source of a finished run on the horizontal plane at `z` (m). */
  generateAnimation: (simulationId: string, z: number, animationMs: number) => Promise<void>;
  cancelAnimation: (simulationId: string) => void;
  /** Forget a failed job (dismisses its error). */
  clearAnimationJob: (simulationId: string) => void;
}

const EMPTY_JOB: PffdtdAnimationJob = { status: 'running', progress: 0, statusText: '', error: null, jobId: null };

/** In-flight poll loops, kept outside Zustand state (not serializable). */
const pollers = new Map<string, ReturnType<typeof setInterval>>();

function stopPoller(simulationId: string): void {
  const timer = pollers.get(simulationId);
  if (timer) clearInterval(timer);
  pollers.delete(simulationId);
}

export const usePffdtdAnimationStore = create<PffdtdAnimationStoreState>()(
  devtools(
    (set, get) => {
      const patchJob = (simulationId: string, update: Partial<PffdtdAnimationJob>, action: string) =>
        set((s) => ({
          jobs: { ...s.jobs, [simulationId]: { ...(s.jobs[simulationId] ?? EMPTY_JOB), ...update } },
        }), false, action);

      const dropJob = (simulationId: string, action: string) =>
        set((s) => {
          const { [simulationId]: _dropped, ...rest } = s.jobs;
          return { jobs: rest };
        }, false, action);

      const fail = (simulationId: string, err: unknown) => {
        stopPoller(simulationId);
        patchJob(simulationId, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err ?? 'Wave animation failed'),
        }, 'pffdtdAnimation/error');
      };

      return {
        jobs: {},

        generateAnimation: async (simulationId, z, animationMs) => {
          stopPoller(simulationId);
          patchJob(simulationId, { status: 'running', progress: 0, statusText: 'Submitting...', error: null, jobId: null }, 'pffdtdAnimation/start');
          let jobId: string;
          try {
            ({ job_id: jobId } = await apiService.runPffdtdAnimation(simulationId, z, animationMs));
          } catch (err) {
            fail(simulationId, err);
            return;
          }
          patchJob(simulationId, { jobId, statusText: 'Queued...' }, 'pffdtdAnimation/queued');

          const timer = setInterval(async () => {
            try {
              const st = await apiService.getPffdtdAnimationStatus(jobId);
              if (st.cancelled) {
                stopPoller(simulationId);
                dropJob(simulationId, 'pffdtdAnimation/cancelled');
                return;
              }
              if (st.error) return fail(simulationId, st.error);
              if (!st.completed) {
                const statusText = st.queue_position != null
                  ? `Queued — position ${st.queue_position} of ${st.queue_total}`
                  : st.status;
                patchJob(simulationId, { progress: st.progress, statusText }, 'pffdtdAnimation/progress');
                return;
              }
              stopPoller(simulationId);
              patchJob(simulationId, { progress: 100, statusText: 'Loading frames...' }, 'pffdtdAnimation/done');
              await usePffdtdVisualsStore.getState().reloadField(simulationId);
              dropJob(simulationId, 'pffdtdAnimation/loaded');
            } catch (err) {
              fail(simulationId, err);
            }
          }, PFFDTD.STATUS_POLL_INTERVAL_MS);
          pollers.set(simulationId, timer);
        },

        cancelAnimation: (simulationId) => {
          stopPoller(simulationId);
          const jobId = get().jobs[simulationId]?.jobId;
          if (jobId) apiService.cancelPffdtdAnimation(jobId).catch(console.warn);
          dropJob(simulationId, 'pffdtdAnimation/cancel');
        },

        clearAnimationJob: (simulationId) => dropJob(simulationId, 'pffdtdAnimation/clear'),
      };
    },
    { name: 'pffdtdAnimationStore' },
  ),
);
