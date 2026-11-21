import type { JobRecord, JobType } from '@/types';
import { apiService } from '@/services/api';
import { useUIStore } from '@/store/uiStore';
import { JOB_RECOVERY_MAX_AGE_MS } from '@/utils/constants';

/**
 * In-flight job tracker.
 *
 * Backed by `localStorage` (NOT `sessionStorage`) so a job keeps being tracked
 * after the window/tab is closed and reopened. The backend keeps computing in
 * its resident worker processes; on reopen `useJobRecovery` reads these records
 * (plus a backend per-workspace listing) and reattaches to the jobs.
 *
 * Every record's meta (stamped with the current model id) is also published to
 * the backend job hash, so other members of a shared workspace — whose browsers
 * have no local record — can reattach the job to the same cards.
 */
const STORAGE_KEY = 'compas-inflight-jobs';

/**
 * Records are kept for JOB_RECOVERY_MAX_AGE_MS after submission: a simulation can
 * run for more than an hour, and a finished one stays recoverable from the
 * backend's finished-simulation records after its job hash expired.
 */
const MAX_AGE_MS = JOB_RECOVERY_MAX_AGE_MS;

/**
 * Simulation results being imported into a card in this tab, by simulation id.
 * The submitting poll and the recovery paths (useJobRecovery) can both see the
 * same finished job; whoever claims it first imports it, the others skip it.
 */
const _claimedSimulationResults = new Set<string>();

export function claimSimulationResult(simulationId: string): boolean {
  if (_claimedSimulationResults.has(simulationId)) return false;
  _claimedSimulationResults.add(simulationId);
  return true;
}

/** Give a claim back when its import failed, so another path may retry it. */
export function releaseSimulationResult(simulationId: string): void {
  _claimedSimulationResults.delete(simulationId);
}

/** Model the current page is bound to (Speckle model or saved Home project). */
function currentModelId(): string | undefined {
  const ui = useUIStore.getState();
  return ui.globalSpeckleData?.model_id ?? ui.homeProject?.modelId ?? undefined;
}

export function recordInflightJob(
  jobId: string,
  jobType: JobType,
  jobMeta?: JobRecord['meta'],
): void {
  const modelId = currentModelId();
  const meta = jobMeta || modelId ? { ...jobMeta, ...(modelId ? { modelId } : {}) } : undefined;
  if (meta) void apiService.setJobClientMeta(jobId, meta);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const jobs: JobRecord[] = raw ? JSON.parse(raw) : [];
    const record: JobRecord = {
      jobId,
      jobType,
      timestamp: Date.now(),
      ...(meta ? { meta } : {}),
    };
    // Dedupe by jobId — a re-record updates the timestamp/meta rather than
    // appending a duplicate. Shared localStorage means tabs must be idempotent.
    const deduped = [record, ...jobs.filter((j) => j.jobId !== jobId)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

export function removeInflightJob(jobId: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const jobs: JobRecord[] = JSON.parse(raw);
    const filtered = jobs.filter((j) => j.jobId !== jobId);
    if (filtered.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {
    // localStorage may be unavailable
  }
}

export function getStoredJobs(): JobRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const jobs: JobRecord[] = JSON.parse(raw);
    const now = Date.now();
    const valid = jobs.filter((j) => now - j.timestamp < MAX_AGE_MS);
    if (valid.length !== jobs.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

export function clearAllJobs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
