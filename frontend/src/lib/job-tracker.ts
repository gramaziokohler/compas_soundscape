import type { JobRecord, JobType } from '@/types';

const STORAGE_KEY = 'compas-inflight-jobs';

export function recordInflightJob(jobId: string, jobType: JobType): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const jobs: JobRecord[] = raw ? JSON.parse(raw) : [];
    jobs.push({ jobId, jobType, timestamp: Date.now() });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

export function removeInflightJob(jobId: string): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const jobs: JobRecord[] = JSON.parse(raw);
    const filtered = jobs.filter((j) => j.jobId !== jobId);
    if (filtered.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {
    // sessionStorage may be unavailable
  }
}

export function getStoredJobs(): JobRecord[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const jobs: JobRecord[] = JSON.parse(raw);
    const now = Date.now();
    const MAX_AGE_MS = 30 * 60 * 1000;
    const valid = jobs.filter((j) => now - j.timestamp < MAX_AGE_MS);
    if (valid.length !== jobs.length) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

export function clearAllJobs(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
