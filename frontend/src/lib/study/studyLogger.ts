import { apiService } from '@/services/api';
import { STUDY_LOG } from '@/utils/constants';
import { toStudyPayload } from '@/lib/study/sanitize';
import type { StudyConfig, StudyEvent, StudyFeatures } from '@/types/study';

/**
 * Research-study event logger (singleton).
 *
 * - `logStudyEvent` is TOTAL: it never throws and returns immediately when the
 *   study is disabled. Payloads are sanitised to plain JSON at enqueue time, so
 *   no reference to app objects is ever retained (plan risks C1 / C2).
 * - Events queue in memory and flush in batches every `flush_interval_ms`;
 *   failures back off exponentially and never surface to the user.
 * - On page hide the queue is mirrored to sessionStorage and sent with
 *   sendBeacon; a reload in the same tab re-sends whatever did not get out.
 *
 * This module must NOT import `@/store`: stores import the logger, and the
 * barrel registers temporal stores at module init — a cycle would break that.
 * Envelope context (model / version / ui mode) comes from a provider that
 * `useStudyLogging` registers at runtime.
 */

export interface StudyEnvelopeContext {
  model_id: string | null;
  version_id: string | null;
  ui_mode: string | null;
}

type LoggerState = 'pending' | 'enabled' | 'disabled';

let _state: LoggerState = 'pending';
let _config: StudyConfig | null = null;
let _initPromise: Promise<StudyConfig | null> | null = null;
let _generation = 0;
let _contextProvider: (() => StudyEnvelopeContext) | null = null;

const _queue: StudyEvent[] = [];
let _dropped = 0;
let _seq = 0;
let _tabSessionId: string | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _inFlight = false;
let _retryDelayMs = 0;
let _nextAttemptAt = 0;

/** UUID that also works on non-secure origins (crypto.randomUUID needs HTTPS). */
export function newStudyId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function tabSessionId(): string {
  if (_tabSessionId) return _tabSessionId;
  _tabSessionId = newStudyId();
  return _tabSessionId;
}

function readContext(): StudyEnvelopeContext {
  try {
    if (_contextProvider) return _contextProvider();
  } catch {
    // provider failure must not lose the event
  }
  return { model_id: null, version_id: null, ui_mode: null };
}

/** Register the envelope context provider (called by useStudyLogging). */
export function setStudyContextProvider(provider: (() => StudyEnvelopeContext) | null): void {
  _contextProvider = provider;
}

export function isStudyLoggingEnabled(): boolean {
  return _state === 'enabled';
}

/** Risk-gated feature switch (all false while disabled or pending). */
export function isStudyFeatureEnabled(feature: keyof StudyFeatures): boolean {
  return _state === 'enabled' && _config?.features?.[feature] === true;
}

export function getStudyConfig(): StudyConfig | null {
  return _config;
}

/**
 * Log one study event. Returns the event id (for linking, e.g. moments), or
 * null when the study is disabled. Never throws.
 */
export function logStudyEvent(type: string, payload?: Record<string, unknown>): string | null {
  if (_state === 'disabled') return null;
  try {
    const ctx = readContext();
    const event: StudyEvent = {
      id: newStudyId(),
      type,
      ts_client: Date.now(),
      seq: ++_seq,
      tab_session_id: tabSessionId(),
      model_id: ctx.model_id,
      version_id: ctx.version_id,
      ui_mode: ctx.ui_mode,
      payload: toStudyPayload(payload),
    };
    _queue.push(event);
    if (_queue.length > STUDY_LOG.MAX_QUEUE_EVENTS) {
      const excess = _queue.length - STUDY_LOG.MAX_QUEUE_EVENTS;
      _queue.splice(0, excess);
      _dropped += excess;
    }
    return event.id;
  } catch {
    return null;
  }
}

// ─── Delivery ────────────────────────────────────────────────────────────────

function batchSize(): number {
  return _config?.max_batch_events || STUDY_LOG.DEFAULT_MAX_BATCH_EVENTS;
}

/** Send one batch now (no-op while a send is in flight or backing off). */
export async function flushStudyEvents(): Promise<void> {
  if (_state !== 'enabled' || _inFlight) return;
  if (_dropped > 0) {
    const dropped = _dropped;
    _dropped = 0;
    logStudyEvent('log.dropped', { count: dropped });
  }
  if (_queue.length === 0 || Date.now() < _nextAttemptAt) return;

  const batch = _queue.slice(0, batchSize());
  _inFlight = true;
  try {
    await apiService.postStudyEvents({ events: batch });
    // Remove exactly what was sent (new events may have been appended meanwhile).
    const sent = new Set(batch.map((e) => e.id));
    for (let i = _queue.length - 1; i >= 0; i--) if (sent.has(_queue[i].id)) _queue.splice(i, 1);
    _retryDelayMs = 0;
    _nextAttemptAt = 0;
  } catch {
    _retryDelayMs = Math.min(
      _retryDelayMs ? _retryDelayMs * 2 : STUDY_LOG.RETRY_BASE_MS,
      STUDY_LOG.RETRY_MAX_MS,
    );
    _nextAttemptAt = Date.now() + _retryDelayMs;
    persistQueue();
  } finally {
    _inFlight = false;
  }
}

function persistQueue(): void {
  try {
    if (_queue.length === 0) sessionStorage.removeItem(STUDY_LOG.QUEUE_STORAGE_KEY);
    else sessionStorage.setItem(STUDY_LOG.QUEUE_STORAGE_KEY, JSON.stringify(_queue));
  } catch {
    // quota / blocked storage — events stay in memory only
  }
}

function restorePersistedQueue(): void {
  try {
    const raw = sessionStorage.getItem(STUDY_LOG.QUEUE_STORAGE_KEY);
    sessionStorage.removeItem(STUDY_LOG.QUEUE_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as StudyEvent[];
    if (!Array.isArray(saved)) return;
    // A remount in the same page still holds these in memory — skip duplicates.
    const queued = new Set(_queue.map((e) => e.id));
    const missing = saved.filter((e) => e && typeof e.id === 'string' && !queued.has(e.id));
    _queue.unshift(...missing.slice(-STUDY_LOG.MAX_QUEUE_EVENTS));
  } catch {
    // corrupt mirror — ignore
  }
}

/** Page is going away: beacon what fits, mirror the rest for the next load. */
function onPageHide(): void {
  if (_state !== 'enabled' || _queue.length === 0) return;
  try {
    while (_queue.length > 0) {
      const chunk: StudyEvent[] = [];
      let bytes = 20;
      while (_queue.length > 0 && chunk.length < batchSize()) {
        const size = JSON.stringify(_queue[0]).length + 1;
        if (chunk.length > 0 && bytes + size > STUDY_LOG.BEACON_MAX_BYTES) break;
        chunk.push(_queue.shift()!);
        bytes += size;
      }
      if (!apiService.beaconStudyEvents(JSON.stringify({ events: chunk }))) {
        _queue.unshift(...chunk);
        break;
      }
    }
  } catch {
    // fall through to the mirror
  }
  persistQueue();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') persistQueue();
}

/**
 * Resolve the study config once (GET /api/study/config). When disabled the
 * buffered events are discarded and every later call is a no-op.
 */
export function initStudyLogger(): Promise<StudyConfig | null> {
  if (_initPromise) return _initPromise;
  const generation = _generation;
  _initPromise = (async () => {
    let config: StudyConfig | null = null;
    try {
      config = await apiService.getStudyConfig();
    } catch {
      config = null;
    }
    // Disposed while the config was loading (unmount / StrictMode remount).
    if (generation !== _generation) return null;
    if (!config?.enabled) {
      _state = 'disabled';
      _queue.length = 0;
      return null;
    }
    _config = config;
    _state = 'enabled';
    restorePersistedQueue();
    const interval = config.flush_interval_ms || STUDY_LOG.DEFAULT_FLUSH_INTERVAL_MS;
    _flushTimer = setInterval(() => void flushStudyEvents(), interval);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return config;
  })();
  return _initPromise;
}

/** Stop timers / listeners (unmount). Queued events are mirrored, not lost. */
export function disposeStudyLogger(): void {
  _generation++;
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  persistQueue();
  _initPromise = null;
  if (_state === 'enabled') _state = 'pending';
}
