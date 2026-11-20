/**
 * Crash probe — `[dbg:crash-probe]` instrumentation for share-mode crashes
 * ("Aw, Snap" / freezes) on very large models.
 *
 * Opt-in per browser with `?diag=1` (remembered in localStorage, `?diag=0` turns it off).
 * A subscriber of the shared performance monitor: every CRASH_PROBE.SAMPLE_INTERVAL_MS it
 * records JS heap, audio IR memory, convolvers, Sounds-view lights and WebGL stats; events
 * (simulation / listener switches, long main-thread tasks, WebGL context loss) are recorded
 * as they happen. The tail is written to localStorage, so after a renderer crash the reload
 * prints the last records of the session that died. `window.__compasCrashProbe` exposes them.
 */
import { CRASH_PROBE } from '@/utils/constants';
import type { CrashProbeRecord, PerformanceSample } from '@/types';
import { subscribePerformance } from './performance-monitor';

interface CrashProbeWindowHandle {
  records: CrashProbeRecord[];
  previous: CrashProbeRecord[];
}

const CLEAN_EXIT_EVENT = 'pagehide';

let active = false;
let records: CrashProbeRecord[] = [];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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

/** Flatten a monitor sample into the probe's record fields (stable keys across versions). */
function sampleRecord(sample: PerformanceSample, extra: Record<string, unknown> | null): CrashProbeRecord {
  const { heap, audio, gl } = sample;
  const data: Record<string, unknown> = {
    ...(heap && { heapUsedMB: round1(heap.usedMB), heapTotalMB: round1(heap.totalMB), heapLimitMB: round1(heap.limitMB) }),
    ...(audio && {
      irCacheCount: audio.irCacheCount,
      irCacheMB: round1(audio.irCacheBytes / CRASH_PROBE.BYTES_PER_MB),
      irCacheBudgetMB: round1(audio.irCacheBudgetBytes / CRASH_PROBE.BYTES_PER_MB),
      irDecodes: audio.irDecodes,
      irRedecodes: audio.irRedecodes,
      convolverBanks: audio.convolverBanks,
      convolverNodes: audio.convolverNodes,
      convolverFilterMB: round1(audio.convolverFilterBytes / CRASH_PROBE.BYTES_PER_MB),
      irRunsInFlight: audio.irRunsInFlight,
    }),
    lights: sample.lights,
    gl,
    newPrograms: sample.newPrograms,
    frames: sample.frames,
    xruns: sample.xruns,
    voices: sample.playingVoices,
    ...extra,
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
 * Start recording. Returns a stop function. Only one probe runs at a time;
 * a second start while running returns a no-op stop.
 * @param getExtraStats - extra per-sample fields (e.g. [dbg:heap] call counters)
 */
export function startCrashProbe(getExtraStats?: () => Record<string, unknown> | null): () => void {
  if (active || typeof window === 'undefined') return () => {};
  active = true;

  const previous = reportPreviousSession();
  records = [];

  const nav = navigator as Navigator & { deviceMemory?: number };
  markCrashProbe('start', {
    url: window.location.pathname,
    deviceMemoryGB: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency ?? null,
  });

  const unsubscribe = subscribePerformance({
    intervalMs: CRASH_PROBE.SAMPLE_INTERVAL_MS,
    onSample: (sample) => {
      const record = sampleRecord(sample, getExtraStats?.() ?? null);
      console.log(CRASH_PROBE.LOG_PREFIX, 'sample', record.data);
      push(record);
    },
    onEvent: ({ name, data }) => {
      const ms = typeof data?.ms === 'number' ? data.ms : 0;
      if (name === 'longtask' && ms < CRASH_PROBE.LONG_TASK_MS) return;
      markCrashProbe(name, data);
    },
  });

  const onPageHide = () => markCrashProbe(CLEAN_EXIT_EVENT);
  window.addEventListener('pagehide', onPageHide);

  const handle: CrashProbeWindowHandle = {
    get records() { return records; },
    previous,
  };
  (window as Window & { __compasCrashProbe?: CrashProbeWindowHandle }).__compasCrashProbe = handle;

  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', onPageHide);
    markCrashProbe(CLEAN_EXIT_EVENT, { reason: 'stopped' });
    active = false;
  };
}
