import type { JobRecord, JobType } from '@/types';
import { apiService } from '@/services/api';
import { useUIStore } from '@/store/uiStore';

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
 * Records older than the backend's `JOB_RESULT_TTL_S` (3600 s) can no longer be
 * fetched — the Redis hash has expired — so drop them. Kept in sync with
 * `backend/config/constants.py::JOB_RESULT_TTL_S`.
 */
const MAX_AGE_MS = 60 * 60 * 1000;

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
