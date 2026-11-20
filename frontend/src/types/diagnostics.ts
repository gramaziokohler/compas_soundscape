/** Audio-engine memory held for simulation IRs (crash probe). */
export interface AudioMemoryStats {
  /** Decoded IRs kept in the orchestrator's irCache. */
  irCacheCount: number;
  irCacheBytes: number;
  irCacheBudgetBytes: number;
  /** IR decodes since load; redecodes = an evicted IR needed again. */
  irDecodes: number;
  irRedecodes: number;
  /** Shared AmbisonicConvolver banks alive in AmbisonicIRMode. */
  convolverBanks: number;
  /** ConvolverNodes rendering across all banks. */
  convolverNodes: number;
  /** Bytes held by the banks' filters (each bank also copies its filter per channel). */
  convolverFilterBytes: number;
  /** updateSourceIRsForReceiver runs currently in flight (more than 1 = overlapping switches). */
  irRunsInFlight: number;
  /** Most IR swaps preparing at once since the previous sample. */
  irRunsPeak: number;
  /** IR swaps (simulation / listener switches) started since load. */
  irSwaps: number;
}

/** Sounds-view point lights (crash probe). */
export interface SoundLightStats {
  total: number;
  /** Pool slots lit this frame. */
  visible: number;
  /** Fixed render-light pool size (constant while Sounds view is on). */
  pool: number;
}

/** One crash-probe record: a periodic sample or a marked event. */
export interface CrashProbeRecord {
  t: string;
  kind: 'sample' | 'event';
  event?: string;
  data?: Record<string, unknown>;
}

/** WebGL renderer stats (three.js renderer.info) for one sample. */
export interface RendererStats {
  programs: number;
  geometries: number;
  textures: number;
  calls: number;
  triangles: number;
}

/** AudioContext health snapshot (AudioOrchestrator.getContextHealth). */
export interface AudioContextHealth {
  state: AudioContextState;
  sampleRate: number;
  baseLatency: number;
  outputLatency: number;
  /** getOutputTimestamp(): context time (s) and the matching performance.now() (ms). */
  contextTime: number;
  performanceTime: number;
  /** Cumulative output underruns where the browser reports them (AudioContext.playbackStats). */
  underruns: number | null;
}

/** Which browser APIs back the metrics (Chromium has all; Firefox / Safari fall back). */
export interface PerformanceSupport {
  heap: boolean;
  longtask: boolean;
  xrun: boolean;
}

/** One performance-monitor sample, shared by the meter, the crash probe and the emergency guard. */
export interface PerformanceSample {
  /** performance.now() when sampled. */
  t: number;
  heap: { usedMB: number; totalMB: number; limitMB: number } | null;
  audio: AudioMemoryStats | null;
  lights: SoundLightStats | null;
  gl: RendererStats | null;
  /** Shader programs compiled within PERFORMANCE_METER.STALL_WINDOW_MS (recompile storms). */
  newPrograms: number;
  /** IR switches (simulation / listener) started within PERFORMANCE_METER.STALL_WINDOW_MS. */
  recentIRSwaps: number;
  /** navigator.deviceMemory (GB, coarse, Chromium only). */
  deviceMemoryGB: number | null;
  /** Frame rate and worst frame gap within the stall window (only while a subscriber needs frames). */
  frames: { fps: number; worstGapMs: number } | null;
  longTasks: { count: number; worstMs: number };
  /** Audio dropouts within PERFORMANCE_METER.XRUN_WINDOW_MS. */
  xruns: number;
  context: AudioContextHealth | null;
  contextLost: boolean;
  playingVoices: number;
  /** Estimated tab memory the app can account for: heap + IR cache + convolver filters (MB). */
  memoryMB: number;
  support: PerformanceSupport;
}

export type PerformanceMetricId = 'mem' | 'cpu' | 'dsp' | 'gpu' | 'xrun';

/** Meter colour band. 'na' = no data in this browser / no source yet. */
export type MeterLevel = 'ok' | 'warn' | 'crit' | 'na';
