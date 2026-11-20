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
import { installHeapProbes, readFilterStateStats, takeHeapProbeStats } from '@/lib/diagnostics/heap-probe';

export function useCrashProbe(): void {
  useEffect(() => {
    if (!isCrashProbeEnabled()) return;
    const stopProbe = startCrashProbe(() => ({
      calls: takeHeapProbeStats(),
      filter: readFilterStateStats(useSpeckleEngineStore.getState().viewer),
    }));

    // [dbg:heap] probes follow the current viewer instance.
    let uninstall: (() => void) | null = null;
    const attach = (viewer: ReturnType<typeof useSpeckleEngineStore.getState>['viewer']) => {
      uninstall?.();
      uninstall = viewer ? installHeapProbes(viewer) : null;
    };
    attach(useSpeckleEngineStore.getState().viewer);
    const unsubViewer = useSpeckleEngineStore.subscribe((state, prev) => {
      if (state.viewer !== prev.viewer) attach(state.viewer);
    });
    const unsubViewMode = useSpeckleStore.subscribe((state, prev) => {
      if (state.viewMode !== prev.viewMode) markCrashProbe('view-mode', { from: prev.viewMode, to: state.viewMode });
    });

    return () => {
      unsubViewer();
      unsubViewMode();
      uninstall?.();
      stopProbe();
    };
  }, []);
}
