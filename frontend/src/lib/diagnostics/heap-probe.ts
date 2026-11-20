/**
 * Heap probe — temporary `[dbg:heap]` instrumentation (crash probe, `?diag=1` only).
 *
 * Wraps the calls suspected of the JS-heap sawtooth on very large models
 * (Speckle filter / material passes and the store actions that drive them),
 * counts them, and accumulates their duration and heap delta between crash-probe
 * samples. A single call that is slow or allocates a lot is logged on its own.
 */
import type { Viewer } from '@speckle/viewer';
import { FilteringExtension } from '@speckle/viewer';
import { useSpeckleStore } from '@/store';
import { CRASH_PROBE } from '@/utils/constants';
import { markCrashProbe } from './crash-probe';

interface CallStats {
  calls: number;
  ms: number;
  heapMB: number;
}

type ProbedName = 'setMaterial' | 'setFilters' | 'applyVisibility' | 'applyFilterColors';

const stats: Record<ProbedName, CallStats> = {
  setMaterial: { calls: 0, ms: 0, heapMB: 0 },
  setFilters: { calls: 0, ms: 0, heapMB: 0 },
  applyVisibility: { calls: 0, ms: 0, heapMB: 0 },
  applyFilterColors: { calls: 0, ms: 0, heapMB: 0 },
};

/** Chromium-only heap reading; 0 elsewhere (deltas then read 0). */
function heapBytes(): number {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory?.usedJSHeapSize ?? 0;
}

type AnyFn = (...args: never[]) => unknown;

/** Wrap `fn` so each call is counted and timed; returns the wrapper. */
function probe<F extends AnyFn>(name: ProbedName, fn: F, describe?: (args: Parameters<F>) => Record<string, unknown>): F {
  const wrapped = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
    const heapBefore = heapBytes();
    const t0 = performance.now();
    try {
      return fn.apply(this, args) as ReturnType<F>;
    } finally {
      const ms = performance.now() - t0;
      const heapMB = (heapBytes() - heapBefore) / CRASH_PROBE.BYTES_PER_MB;
      const s = stats[name];
      s.calls++;
      s.ms += ms;
      s.heapMB += heapMB;
      if (ms >= CRASH_PROBE.HEAP_PROBE_SLOW_MS || heapMB >= CRASH_PROBE.HEAP_PROBE_ALLOC_MB) {
        markCrashProbe(`heap:${name}`, {
          ms: Math.round(ms),
          heapMB: Math.round(heapMB * 10) / 10,
          ...describe?.(args),
        });
      }
    }
  };
  return wrapped as unknown as F;
}

/** Counters accumulated since the last call, then reset (one crash-probe sample). */
export function takeHeapProbeStats(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, s] of Object.entries(stats) as Array<[ProbedName, CallStats]>) {
    if (s.calls === 0) continue;
    out[name] = `${s.calls}× ${Math.round(s.ms)}ms ${Math.round(s.heapMB)}MB`;
    s.calls = 0;
    s.ms = 0;
    s.heapMB = 0;
  }
  return out;
}

/**
 * Speckle FilteringExtension internals read at a system boundary: `idCache` is
 * private in the typings (a string-keyed memo of include-descendants walks) and
 * `setFilters` is the private pass every public filter call ends in.
 */
interface FilteringInternals {
  idCache?: Record<string, unknown>;
  setFilters?: AnyFn;
}

/**
 * The viewer's FilteringExtension, or null. Speckle's getExtension THROWS ("Could not
 * get Extension of type …") while the extension is not created yet — the viewer is
 * published to the engine store before its extensions, so never call it unguarded here.
 */
function filteringExtensionOf(viewer: Viewer | null): FilteringExtension | null {
  if (!viewer) return null;
  try {
    return viewer.getExtension(FilteringExtension) ?? null;
  } catch {
    return null;
  }
}

/** Size of the viewer's filter state: hidden ids and the descendant-id memo. */
export function readFilterStateStats(viewer: Viewer | null): Record<string, number> | null {
  const ext = filteringExtensionOf(viewer);
  if (!ext) return null;
  const internals = ext as unknown as FilteringInternals;
  const cacheKeys = internals.idCache ? Object.keys(internals.idCache) : [];
  return {
    hiddenObjects: ext.filteringState?.hiddenObjects?.length ?? 0,
    isolatedObjects: ext.filteringState?.isolatedObjects?.length ?? 0,
    idCacheEntries: cacheKeys.length,
    idCacheKeyKB: Math.round(cacheKeys.reduce((n, k) => n + k.length, 0) / 1024),
  };
}

/** Install the wrappers on this viewer and the speckle store. Returns an uninstall function. */
export function installHeapProbes(viewer: Viewer): () => void {
  const restores: Array<() => void> = [];

  const renderer = viewer.getRenderer();
  const origSetMaterial = renderer.setMaterial;
  renderer.setMaterial = probe('setMaterial', origSetMaterial.bind(renderer), (args) => ({
    renderViews: Array.isArray(args[0]) ? (args[0] as unknown[]).length : 0,
  })) as typeof renderer.setMaterial;
  restores.push(() => { renderer.setMaterial = origSetMaterial; });

  const ext = filteringExtensionOf(viewer) as unknown as FilteringInternals | null;
  const origSetFilters = ext?.setFilters;
  if (ext && origSetFilters) {
    ext.setFilters = probe('setFilters', origSetFilters.bind(ext));
    restores.push(() => { ext.setFilters = origSetFilters; });
  }

  // Store actions are read through get() inside the store, so replacing them in state
  // instruments internal calls too.
  const { applyVisibility, applyFilterColors } = useSpeckleStore.getState();
  useSpeckleStore.setState({
    applyVisibility: probe('applyVisibility', applyVisibility),
    applyFilterColors: probe('applyFilterColors', applyFilterColors),
  });
  restores.push(() => useSpeckleStore.setState({ applyVisibility, applyFilterColors }));

  markCrashProbe('heap-probes-installed', { setFilters: Boolean(origSetFilters) });
  return () => restores.forEach((restore) => restore());
}
