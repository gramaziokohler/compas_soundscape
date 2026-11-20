/**
 * useCrashProbe — runs the `[dbg:crash-probe]` recorder (lib/diagnostics/crash-probe.ts)
 * while `?diag=1` is enabled in this browser. Samples come from the shared performance
 * monitor (sources wired by usePerformanceSources); this hook adds the `[dbg:heap]`
 * call probes on each viewer and records view-mode switches.
 */
import { useEffect } from 'react';
import { useSpeckleStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { isCrashProbeEnabled, markCrashProbe, startCrashProbe } from '@/lib/diagnostics/crash-probe';
import { CRASH_PROBE } from '@/utils/constants';
import { installHeapProbes, readFilterStateStats, takeHeapProbeStats } from '@/lib/diagnostics/heap-probe';

export function useCrashProbe(): void {
  useEffect(() => {
    if (!isCrashProbeEnabled()) return;
    const stopProbe = startCrashProbe(() => ({
      calls: takeHeapProbeStats(),
      filter: readFilterStateStats(useSpeckleEngineStore.getState().viewer),
    }));

    // [dbg:heap] probes follow the current viewer instance. The engine store publishes the
    // viewer before its extensions exist and calls subscribers synchronously inside viewer
    // init, so installing waits for the extensions (polled) and can never throw into init.
    type ViewerOrNull = ReturnType<typeof useSpeckleEngineStore.getState>['viewer'];
    let uninstall: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const attach = (viewer: ViewerOrNull, attemptsLeft: number = CRASH_PROBE.HEAP_PROBE_INSTALL_ATTEMPTS) => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      uninstall?.();
      uninstall = null;
      if (!viewer) return;
      if (useSpeckleEngineStore.getState().filteringExtension) {
        try {
          uninstall = installHeapProbes(viewer);
        } catch (error) {
          console.warn('[dbg:heap] probes not installed:', error);
        }
        return;
      }
      if (attemptsLeft > 0) {
        retryTimer = setTimeout(() => attach(viewer, attemptsLeft - 1), CRASH_PROBE.HEAP_PROBE_INSTALL_RETRY_MS);
      }
    };
    attach(useSpeckleEngineStore.getState().viewer);
    const unsubViewer = useSpeckleEngineStore.subscribe((state, prev) => {
      if (state.viewer !== prev.viewer) attach(state.viewer);
    });
    const unsubViewMode = useSpeckleStore.subscribe((state, prev) => {
      if (state.viewMode !== prev.viewMode) markCrashProbe('view-mode', { from: prev.viewMode, to: state.viewMode });
    });

    return () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      unsubViewer();
      unsubViewMode();
      uninstall?.();
      stopProbe();
    };
  }, []);
}
