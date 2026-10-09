import packageJson from '../../../package.json';
import { useErrorsStore, useUIStore } from '@/store';
import { getStoredJobs } from '@/lib/job-tracker';
import { getDiagnosticsSnapshot } from '@/lib/diagnostics/diagnosticsBuffer';
import { BUG_REPORT } from '@/utils/constants';
import type { BugReportContext } from '@/types';

/**
 * Build the diagnostics snapshot attached to a bug report.
 *
 * The base fields (URL, model, UI mode, browser, viewport) are always sent so a
 * report can be located; `includeDiagnostics` adds recent notifications,
 * in-flight jobs, console errors, and failed API requests.
 */
export function collectBugReportContext(includeDiagnostics: boolean): BugReportContext {
  const url = new URL(window.location.href);
  const context: BugReportContext = {
    page_url: url.toString(),
    model_id: url.searchParams.get('model_id') ?? url.searchParams.get('home'),
    user_agent: navigator.userAgent,
    app_version: packageJson.version,
    ui_mode: useUIStore.getState().uiMode,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    client_time: new Date().toISOString(),
  };
  if (!includeDiagnostics) return context;

  const { logs, failedRequests } = getDiagnosticsSnapshot();
  context.notifications = useErrorsStore
    .getState()
    .notifications.slice(-BUG_REPORT.NOTIFICATIONS_MAX)
    .map(({ type, message, timestamp }) => ({ type, message, timestamp }));
  context.inflight_jobs = getStoredJobs().map(({ jobId, jobType, timestamp }) => ({ jobId, jobType, timestamp }));
  context.logs = logs;
  context.failed_requests = failedRequests;
  return context;
}

/** Counts shown in the panel's "What's included" preview. */
export function summarizeDiagnostics(): { logs: number; failedRequests: number; notifications: number } {
  const { logs, failedRequests } = getDiagnosticsSnapshot();
  return {
    logs: logs.length,
    failedRequests: failedRequests.length,
    notifications: Math.min(useErrorsStore.getState().notifications.length, BUG_REPORT.NOTIFICATIONS_MAX),
  };
}
