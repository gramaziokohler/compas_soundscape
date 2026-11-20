/**
 * Performance monitor — ONE sampler shared by every consumer (performance meter,
 * `?diag=1` crash probe, emergency guard), so nothing is polled twice.
 *
 * - `setPerformanceSources()` wires the live app objects (page.tsx, usePerformanceSources).
 * - `subscribePerformance()` registers a consumer with its own interval. The monitor
 *   ticks at the smallest interval any subscriber asked for and hands each one the
 *   shared sample when its own interval has elapsed. It starts with the first
 *   subscriber and stops with the last (the public share view has none).
 * - Owns the long-task observer, the WebGL context-loss watcher, the frame tracker
 *   (rAF only while a subscriber `needsFrames`) and the audio dropout tracker.
 */
import { CRASH_PROBE, PERFORMANCE_METER } from '@/utils/constants';
import type {
  AudioContextHealth,
  AudioMemoryStats,
  PerformanceSample,
  RendererStats,
  SoundLightStats,
} from '@/types';
import { FrameTracker } from './frame-tracker';
import { AudioGlitchTracker } from './audio-glitch-tracker';

export interface PerformanceSources {
  getAudioStats: () => AudioMemoryStats | null;
  getContextHealth: () => AudioContextHealth | null;
  getPlayingVoices: () => number;
  getLightStats: () => SoundLightStats | null;
  getRendererStats: () => RendererStats | null;
  getCanvas: () => HTMLCanvasElement | null;
}

export interface PerformanceEvent {
  name: 'longtask' | 'webglcontextlost' | 'webglcontextrestored';
  data?: Record<string, unknown>;
}

export interface PerformanceSubscriber {
  intervalMs: number;
  onSample: (sample: PerformanceSample) => void;
  onEvent?: (event: PerformanceEvent) => void;
  /** Track frame rate / gaps with requestAnimationFrame (costs one rAF loop). */
  needsFrames?: boolean;
}

interface SubscriberState extends PerformanceSubscriber {
  lastDelivered: number;
}

/** Chromium-only `performance.memory` (non-standard). */
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const toMB = (bytes: number) => bytes / CRASH_PROBE.BYTES_PER_MB;

let sources: PerformanceSources | null = null;
const subscribers = new Set<SubscriberState>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let tickMs = 0;
let longTaskObserver: PerformanceObserver | null = null;
let longTasks: Array<{ t: number; ms: number }> = [];
let programHistory: Array<{ t: number; programs: number }> = [];
let irSwapHistory: Array<{ t: number; swaps: number }> = [];
let watchedCanvas: HTMLCanvasElement | null = null;
let contextLost = false;
const frames = new FrameTracker();
const glitches = new AudioGlitchTracker();

/** Wire (or clear) the live sources. Safe to call before or after subscribers exist. */
export function setPerformanceSources(next: PerformanceSources | null): void {
  sources = next;
}

function emit(event: PerformanceEvent): void {
  for (const s of subscribers) s.onEvent?.(event);
}

const onContextLost = () => {
  contextLost = true;
  emit({ name: 'webglcontextlost' });
};
const onContextRestored = () => {
  contextLost = false;
  emit({ name: 'webglcontextrestored' });
};

function watchCanvas(): void {
  const canvas = sources?.getCanvas() ?? null;
  if (canvas === watchedCanvas) return;
  watchedCanvas?.removeEventListener('webglcontextlost', onContextLost);
  watchedCanvas?.removeEventListener('webglcontextrestored', onContextRestored);
  canvas?.addEventListener('webglcontextlost', onContextLost);
  canvas?.addEventListener('webglcontextrestored', onContextRestored);
  watchedCanvas = canvas;
  contextLost = false;
}

function heapStats(): PerformanceSample['heap'] {
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!memory) return null;
  return {
    usedMB: toMB(memory.usedJSHeapSize),
    totalMB: toMB(memory.totalJSHeapSize),
    limitMB: toMB(memory.jsHeapSizeLimit),
  };
}

/** Read every source once (each guarded: a failing source never breaks the sample). */
function safe<T>(read: (() => T) | undefined, fallback: T): T {
  if (!read) return fallback;
  try {
    return read();
  } catch {
    return fallback;
  }
}

function takeSample(now: number): PerformanceSample {
  watchCanvas();
  const heap = heapStats();
  const audio = safe(sources?.getAudioStats, null);
  const gl = safe(sources?.getRendererStats, null);
  const context = safe(sources?.getContextHealth, null);

  if (gl) programHistory.push({ t: now, programs: gl.programs });
  programHistory = programHistory.filter((p) => now - p.t <= PERFORMANCE_METER.STALL_WINDOW_MS);
  const newPrograms = gl && programHistory.length > 0 ? Math.max(0, gl.programs - programHistory[0].programs) : 0;
  if (audio) irSwapHistory.push({ t: now, swaps: audio.irSwaps });
  irSwapHistory = irSwapHistory.filter((p) => now - p.t <= PERFORMANCE_METER.STALL_WINDOW_MS);
  // The first entry in the window is the baseline, so a swap started before it is not counted.
  const recentIRSwaps = audio && irSwapHistory.length > 1 ? audio.irSwaps - irSwapHistory[0].swaps : 0;

  longTasks = longTasks.filter((l) => now - l.t <= PERFORMANCE_METER.STALL_WINDOW_MS);
  const audioMB = audio ? toMB(audio.irCacheBytes + audio.convolverFilterBytes) : 0;

  return {
    t: now,
    heap,
    audio,
    lights: safe(sources?.getLightStats, null),
    gl,
    newPrograms,
    recentIRSwaps,
    deviceMemoryGB: typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null : null,
    frames: frames.running ? frames.snapshot(now) : null,
    longTasks: { count: longTasks.length, worstMs: longTasks.reduce((w, l) => Math.max(w, l.ms), 0) },
    xruns: glitches.update(context, now),
    context,
    contextLost,
    playingVoices: safe(sources?.getPlayingVoices, 0),
    memoryMB: (heap?.usedMB ?? 0) + audioMB,
    support: {
      heap: heap !== null,
      longtask: longTaskObserver !== null,
      xrun: AudioGlitchTracker.supported(context),
    },
  };
}

function tick(): void {
  if (typeof document !== 'undefined' && document.hidden) return; // paused while the tab is hidden
  const now = performance.now();
  const due = [...subscribers].filter((s) => now - s.lastDelivered >= s.intervalMs - tickMs / 2);
  if (due.length === 0) return;
  const sample = takeSample(now);
  for (const s of due) {
    s.lastDelivered = now;
    try {
      s.onSample(sample);
    } catch (error) {
      console.error('[performance-monitor] subscriber failed:', error);
    }
  }
}

function startObservers(): void {
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
  longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < PERFORMANCE_METER.STALL_MS) continue;
      longTasks.push({ t: performance.now(), ms: entry.duration });
      emit({ name: 'longtask', data: { ms: Math.round(entry.duration) } });
    }
  });
  longTaskObserver.observe({ type: 'longtask', buffered: false });
}

function stopAll(): void {
  if (intervalId !== null) clearInterval(intervalId);
  intervalId = null;
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  longTasks = [];
  programHistory = [];
  irSwapHistory = [];
  frames.stop();
  watchedCanvas?.removeEventListener('webglcontextlost', onContextLost);
  watchedCanvas?.removeEventListener('webglcontextrestored', onContextRestored);
  watchedCanvas = null;
}

/** Re-plan the tick interval and the frame tracker after the subscriber set changed. */
function reschedule(): void {
  if (subscribers.size === 0) {
    stopAll();
    return;
  }
  startObservers();
  const wantFrames = [...subscribers].some((s) => s.needsFrames);
  if (wantFrames) frames.start();
  else frames.stop();

  const nextTick = Math.min(...[...subscribers].map((s) => s.intervalMs));
  if (nextTick !== tickMs || intervalId === null) {
    if (intervalId !== null) clearInterval(intervalId);
    tickMs = nextTick;
    intervalId = setInterval(tick, tickMs);
  }
}

/** Subscribe a consumer; returns the unsubscribe function. The first sample arrives at once. */
export function subscribePerformance(subscriber: PerformanceSubscriber): () => void {
  if (typeof window === 'undefined') return () => {};
  const state: SubscriberState = { ...subscriber, lastDelivered: 0 };
  subscribers.add(state);
  reschedule();
  tick();
  return () => {
    subscribers.delete(state);
    reschedule();
  };
}

/** Number of live subscribers (0 in the share view). */
export function performanceSubscriberCount(): number {
  return subscribers.size;
}
