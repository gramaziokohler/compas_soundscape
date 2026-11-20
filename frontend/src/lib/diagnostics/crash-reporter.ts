/**
 * Crash reporter — always on (editor and share view), silent, best effort.
 *
 * A crashed tab ("Aw, Snap") or a frozen tab the user had to kill never runs its
 * unload handlers, so crashes are detected on the NEXT load: every live tab keeps a
 * heartbeat in localStorage (`CLIENT_DIAGNOSTICS.SESSION_KEY_PREFIX<id>`, refreshed
 * every HEARTBEAT_MS with a small summary of its last performance sample) and removes
 * it on a clean `pagehide`. At start, any heartbeat older than STALE_MS belongs to a
 * session that died: it is reported as `crash` (with that last sample) and deleted.
 * Emergency-guard triggers and WebGL context loss are reported as they happen.
 * Everything goes to the backend client-diagnostics log (POST /api/public/client-diagnostics).
 */
import { CLIENT_DIAGNOSTICS, MEMORY_UNITS, VIEWER_RECOVERY } from '@/utils/constants';
import { apiService } from '@/services/api';
import { useShareViewStore } from '@/store';
import type { ClientDiagnosticEvent, PerformanceSample } from '@/types';
import { subscribePerformance } from './performance-monitor';

interface Heartbeat {
  page: string;
  shareId: string | null;
  startedAt: number;
  lastBeatAt: number;
  /** Hidden tabs stop beating (samples pause, timers are throttled): judged with HIDDEN_STALE_MS. */
  hidden: boolean;
  last: Record<string, number | null> | null;
}

const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let started = false;

function shareId(): string | null {
  return useShareViewStore.getState().shareId ?? null;
}

/** Send one event (fire-and-forget). */
export function reportClientDiagnostic(
  kind: ClientDiagnosticEvent['kind'],
  details: Record<string, unknown>,
  overrides: Partial<Pick<ClientDiagnosticEvent, 'page' | 'share_id' | 'client_session_id' | 'occurred_at'>> = {},
): void {
  if (typeof window === 'undefined') return;
  void apiService.reportClientDiagnostic({
    kind,
    page: window.location.pathname,
    share_id: shareId(),
    client_session_id: sessionId,
    occurred_at: new Date().toISOString(),
    details,
    ...overrides,
  });
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Compact, stable summary of a sample for the heartbeat / crash report. */
function summarize(sample: PerformanceSample): Record<string, number | null> {
  const round = (v: number) => Math.round(v);
  return {
    memoryMB: round(sample.memoryMB),
    heapMB: sample.heap ? round(sample.heap.usedMB) : null,
    heapLimitMB: sample.heap ? round(sample.heap.limitMB) : null,
    irCacheMB: sample.audio ? round(sample.audio.irCacheBytes / MEMORY_UNITS.BYTES_PER_MB) : null,
    convolverNodes: sample.audio?.convolverNodes ?? null,
    worstStallMs: round(sample.longTasks.worstMs),
    shaders: sample.gl?.programs ?? null,
    voices: sample.playingVoices,
  };
}

/** Report (and delete) heartbeats left behind by sessions that died. */
function reportDeadSessions(store: Storage): void {
  const now = Date.now();
  const ownKey = CLIENT_DIAGNOSTICS.SESSION_KEY_PREFIX + sessionId;
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (!key || key === ownKey || !key.startsWith(CLIENT_DIAGNOSTICS.SESSION_KEY_PREFIX)) continue;
    let beat: Heartbeat | null = null;
    try {
      beat = JSON.parse(store.getItem(key) ?? 'null') as Heartbeat | null;
    } catch {
      beat = null;
    }
    const staleMs = beat?.hidden ? CLIENT_DIAGNOSTICS.HIDDEN_STALE_MS : CLIENT_DIAGNOSTICS.STALE_MS;
    if (beat && now - beat.lastBeatAt < staleMs) continue; // another live (or background) tab
    store.removeItem(key);
    if (!beat) continue;
    reportClientDiagnostic(
      'crash',
      {
        ...beat.last,
        lastBeatAgeS: Math.round((now - beat.lastBeatAt) / 1000),
        sessionDurationS: Math.round((beat.lastBeatAt - beat.startedAt) / 1000),
      },
      {
        page: beat.page,
        share_id: beat.shareId,
        client_session_id: key.slice(CLIENT_DIAGNOSTICS.SESSION_KEY_PREFIX.length),
        occurred_at: new Date(beat.lastBeatAt).toISOString(),
      },
    );
  }
}

/** Report a render error caught by the scene's ErrorBoundary. */
export function reportSceneRenderError(error: Error, info: { componentStack?: string | null }): void {
  console.error('[ErrorBoundary] scene render error:', error);
  reportClientDiagnostic('render-error', {
    message: error.message,
    stack: (error.stack ?? '').slice(0, VIEWER_RECOVERY.STACK_CHARS),
    componentStack: (info.componentStack ?? '').slice(0, VIEWER_RECOVERY.STACK_CHARS),
  });
}

/** Start heartbeats + crash detection for this tab. Returns a stop function (clean exit). */
export function startCrashReporter(): () => void {
  const store = typeof window !== 'undefined' ? storage() : null;
  if (!store || started) return () => {};
  started = true;

  const key = CLIENT_DIAGNOSTICS.SESSION_KEY_PREFIX + sessionId;
  const beat: Heartbeat = {
    page: window.location.pathname,
    shareId: shareId(),
    startedAt: Date.now(),
    lastBeatAt: Date.now(),
    hidden: document.hidden,
    last: null,
  };
  const write = () => {
    beat.lastBeatAt = Date.now();
    beat.hidden = document.hidden;
    beat.shareId = shareId();
    try {
      store.setItem(key, JSON.stringify(beat));
    } catch {
      // Storage full / blocked: crash detection is best effort.
    }
  };

  reportDeadSessions(store);
  write();

  const unsubscribe = subscribePerformance({
    intervalMs: CLIENT_DIAGNOSTICS.HEARTBEAT_MS,
    onSample: (sample) => {
      beat.last = summarize(sample);
      write();
    },
    onEvent: ({ name }) => {
      if (name === 'webglcontextlost') reportClientDiagnostic('webgl-context-lost', { ...beat.last });
    },
  });
  // A clean exit removes the heartbeat; a back/forward-cache restore brings it back.
  const onPageHide = () => store.removeItem(key);
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) write();
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', write);

  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', write);
    store.removeItem(key);
    started = false;
  };
}
