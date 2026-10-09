/**
 * In-app bug report types — mirror `BugReportCreate` / `BugReportCreated`
 * in backend/models/schemas.py.
 */

export type BugReportCategory = 'bug' | 'visual' | 'performance' | 'idea';

export type BugReportLogLevel = 'error' | 'warn' | 'uncaught' | 'rejection';

/** One captured console / runtime error (lib/diagnostics/diagnosticsBuffer.ts). */
export interface BugReportLogEntry {
  level: BugReportLogLevel;
  message: string;
  timestamp: number;
}

/** One non-OK API response recorded by `fetchWithErrorHandling`. */
export interface BugReportFailedRequest {
  method: string;
  url: string;
  status: number;
  timestamp: number;
}

/** Diagnostics snapshot attached to a report (snake_case: lifted into DB columns). */
export interface BugReportContext {
  page_url: string;
  model_id: string | null;
  user_agent: string;
  app_version: string;
  ui_mode: string;
  viewport: { width: number; height: number; dpr: number };
  language: string;
  timezone: string;
  client_time: string;
  notifications?: { type: string; message: string; timestamp: number }[];
  inflight_jobs?: { jobId: string; jobType: string; timestamp: number }[];
  logs?: BugReportLogEntry[];
  failed_requests?: BugReportFailedRequest[];
  screenshot_error?: string;
}

export interface BugReportPayload {
  description: string;
  category: BugReportCategory;
  context: BugReportContext;
  /** PNG/JPEG data URL. */
  screenshot?: string;
}

export interface BugReportCreated {
  id: string;
  created_at: string;
}
