/**
 * Crash probe — temporary `[dbg:crash-probe]` instrumentation for share-mode crashes
 * ("Aw, Snap" / freezes) on very large models.
 *
 * Opt-in per browser with `?diag=1` (remembered in localStorage, `?diag=0` turns it off).
 * Every CRASH_PROBE.SAMPLE_INTERVAL_MS it records JS heap, audio IR memory, convolver
 * count, Sounds-view light count and WebGL renderer stats; events (simulation / listener
 * switches, long main-thread tasks, WebGL context loss) are recorded as they happen.
 * The tail is written to localStorage, so after a renderer crash the reload prints the
 * last records of the session that died. `window.__compasCrashProbe` exposes them.
 */
import { CRASH_PROBE } from '@/utils/constants';
import type { AudioMemoryStats, SoundLightStats, CrashProbeRecord } from '@/types';

export interface RendererStats {
  programs: number;
  geometries: number;
  textures: number;
  calls: number;
  triangles: number;
}

export interface CrashProbeSources {
  getAudioStats: () => AudioMemoryStats | null;
  getLightStats: () => SoundLightStats | null;
  getRendererStats: () => RendererStats | null;
  getCanvas: () => HTMLCanvasElement | null;
  /** Extra per-sample fields (e.g. [dbg:heap] call counters, filter-state sizes). */
  getExtraStats?: () => Record<string, unknown> | null;
}

/** Chromium-only `performance.memory` (non-standard; absent elsewhere). */
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface CrashProbeWindowHandle {
  records: CrashProbeRecord[];
  previous: CrashProbeRecord[];
  sample: () => CrashProbeRecord | null;
}

const CLEAN_EXIT_EVENT = 'pagehide';

let active = false;
let records: CrashProbeRecord[] = [];

function toMB(bytes: number): number {
  return Math.round((bytes / CRASH_PROBE.BYTES_PER_MB) * 10) / 10;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the in-memory records still work.
  }
}

/** True when `?diag=1` is in the URL now or was on an earlier load in this browser. */
export function isCrashProbeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get(CRASH_PROBE.QUERY_PARAM);
  if (param === '1') writeStorage(CRASH_PROBE.ENABLED_STORAGE_KEY, '1');
  if (param === '0') writeStorage(CRASH_PROBE.ENABLED_STORAGE_KEY, null);
  return readStorage(CRASH_PROBE.ENABLED_STORAGE_KEY) === '1';
}

function persist(): void {
  writeStorage(CRASH_PROBE.RECORDS_STORAGE_KEY, JSON.stringify(records));
}

function push(record: CrashProbeRecord): void {
  records.push(record);
  if (records.length > CRASH_PROBE.MAX_RECORDS) records.splice(0, records.length - CRASH_PROBE.MAX_RECORDS);
  persist();
}

/** Record an event (no-op unless the probe is running). */
export function markCrashProbe(event: string, data?: Record<string, unknown>): void {
  if (!active) return;
  const record: CrashProbeRecord = { t: new Date().toISOString(), kind: 'event', event, data };
  console.log(CRASH_PROBE.LOG_PREFIX, event, data ?? '');
  push(record);
}

function heapStats(): Record<string, number> | null {
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!memory) return null;
  return {
    heapUsedMB: toMB(memory.usedJSHeapSize),
    heapTotalMB: toMB(memory.totalJSHeapSize),
    heapLimitMB: toMB(memory.jsHeapSizeLimit),
  };
}

function takeSample(sources: CrashProbeSources): CrashProbeRecord {
  const audio = sources.getAudioStats();
  const data: Record<string, unknown> = {
    ...heapStats(),
    ...(audio && {
      irCacheCount: audio.irCacheCount,
      irCacheMB: toMB(audio.irCacheBytes),
      convolverBanks: audio.convolverBanks,
      convolverNodes: audio.convolverNodes,
      convolverFilterMB: toMB(audio.convolverFilterBytes),
      irRunsInFlight: audio.irRunsInFlight,
    }),
    lights: sources.getLightStats(),
    gl: sources.getRendererStats(),
    ...sources.getExtraStats?.(),
  };
  return { t: new Date().toISOString(), kind: 'sample', data };
}

function reportPreviousSession(): CrashProbeRecord[] {
  const raw = readStorage(CRASH_PROBE.RECORDS_STORAGE_KEY);
  if (!raw) return [];
  let previous: CrashProbeRecord[] = [];
  try {
    previous = JSON.parse(raw) as CrashProbeRecord[];
  } catch {
    return [];
  }
  const last = previous[previous.length - 1];
  if (last && last.event !== CLEAN_EXIT_EVENT) {
    console.warn(
      CRASH_PROBE.LOG_PREFIX,
      `previous session did not end cleanly (last record ${last.t}); tail:`,
      previous.slice(-CRASH_PROBE.PREVIOUS_SESSION_TAIL),
    );
  }
  return previous;
}

/**
 * Start sampling. Returns a stop function. Only one probe runs at a time;
 * a second start while running returns a no-op stop.
 */
export function startCrashProbe(sources: CrashProbeSources): () => void {
  if (active || typeof window === 'undefined') return () => {};
  active = true;

  const previous = reportPreviousSession();
  records = [];

  const nav = navigator as Navigator & { deviceMemory?: number };
  markCrashProbe('start', {
    url: window.location.pathname,
    deviceMemoryGB: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency ?? null,
    ...heapStats(),
  });

  // WebGL context loss: the canvas can be (re)created after start, so re-check each sample.
  let watchedCanvas: HTMLCanvasElement | null = null;
  const onContextLost = () => markCrashProbe('webglcontextlost');
  const onContextRestored = () => markCrashProbe('webglcontextrestored');
  const watchCanvas = () => {
    const canvas = sources.getCanvas();
    if (canvas === watchedCanvas) return;
    watchedCanvas?.removeEventListener('webglcontextlost', onContextLost);
    watchedCanvas?.removeEventListener('webglcontextrestored', onContextRestored);
    canvas?.addEventListener('webglcontextlost', onContextLost);
    canvas?.addEventListener('webglcontextrestored', onContextRestored);
    watchedCanvas = canvas;
  };

  // Freezes: main-thread tasks longer than LONG_TASK_MS (Chromium only).
  let longTaskObserver: PerformanceObserver | null = null;
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= CRASH_PROBE.LONG_TASK_MS) {
          markCrashProbe('longtask', { ms: Math.round(entry.duration) });
        }
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false });
  }

  const sample = () => {
    watchCanvas();
    const record = takeSample(sources);
    console.log(CRASH_PROBE.LOG_PREFIX, 'sample', record.data);
    push(record);
    return record;
  };
  const intervalId = window.setInterval(sample, CRASH_PROBE.SAMPLE_INTERVAL_MS);
  sample();

  const onPageHide = () => markCrashProbe(CLEAN_EXIT_EVENT);
  window.addEventListener('pagehide', onPageHide);

  const handle: CrashProbeWindowHandle = {
    get records() { return records; },
    previous,
    sample: () => (active ? sample() : null),
  };
  (window as Window & { __compasCrashProbe?: CrashProbeWindowHandle }).__compasCrashProbe = handle;

  return () => {
    window.clearInterval(intervalId);
    longTaskObserver?.disconnect();
    window.removeEventListener('pagehide', onPageHide);
    watchedCanvas?.removeEventListener('webglcontextlost', onContextLost);
    watchedCanvas?.removeEventListener('webglcontextrestored', onContextRestored);
    markCrashProbe(CLEAN_EXIT_EVENT, { reason: 'stopped' });
    active = false;
  };
}
