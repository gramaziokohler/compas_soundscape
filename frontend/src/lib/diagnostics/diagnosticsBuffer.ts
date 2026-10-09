import { BUG_REPORT } from '@/utils/constants';
import type { BugReportFailedRequest, BugReportLogEntry, BugReportLogLevel } from '@/types';

/**
 * Diagnostics ring buffers for bug reports.
 *
 * Keeps the most recent console errors / warnings, uncaught errors, unhandled
 * promise rejections, and non-OK API responses so a bug report can show what
 * went wrong just before the user clicked the bug button. Everything stays in
 * memory — nothing is sent unless the user submits a report.
 */

const logs: BugReportLogEntry[] = [];
const failedRequests: BugReportFailedRequest[] = [];
let installed = false;

function push<T>(buffer: T[], entry: T, max: number): void {
  buffer.push(entry);
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function recordLog(level: BugReportLogLevel, args: unknown[]): void {
  const message = args.map(stringifyArg).join(' ').slice(0, BUG_REPORT.LOG_MESSAGE_MAX_CHARS);
  push(logs, { level, message, timestamp: Date.now() }, BUG_REPORT.LOG_BUFFER_SIZE);
}

/**
 * Start capturing console errors / warnings and runtime errors. Idempotent and
 * a no-op on the server; the original console methods are still called.
 */
export function installDiagnosticsCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    recordLog('error', args);
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    recordLog('warn', args);
    originalWarn(...args);
  };

  window.addEventListener('error', (e) => {
    recordLog('uncaught', [e.error ?? e.message]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    recordLog('rejection', [e.reason]);
  });
}

/** Record a non-OK API response (called from `fetchWithErrorHandling`). */
export function recordFailedRequest(method: string, url: string, status: number): void {
  push(
    failedRequests,
    { method: method.toUpperCase(), url: url.slice(0, BUG_REPORT.LOG_MESSAGE_MAX_CHARS), status, timestamp: Date.now() },
    BUG_REPORT.FAILED_REQUEST_BUFFER_SIZE,
  );
}

/** Copy of the current buffers (oldest first). */
export function getDiagnosticsSnapshot(): { logs: BugReportLogEntry[]; failedRequests: BugReportFailedRequest[] } {
  return { logs: [...logs], failedRequests: [...failedRequests] };
}
