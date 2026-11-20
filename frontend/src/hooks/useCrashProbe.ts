/**
 * useCrashProbe — runs the `[dbg:crash-probe]` sampler (lib/diagnostics/crash-probe.ts)
 * while `?diag=1` is enabled in this browser. Reads the audio engine, the Sounds-view
 * lights and the Speckle WebGL renderer through refs, so it starts once and never
 * re-subscribes when the orchestrator or viewer instance changes. Also installs the
 * `[dbg:heap]` call probes on each viewer and records view-mode switches.
 */
import { useEffect, useRef } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useSpeckleStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { isCrashProbeEnabled, markCrashProbe, startCrashProbe, type RendererStats } from '@/lib/diagnostics/crash-probe';
import { installHeapProbes, readFilterStateStats, takeHeapProbeStats } from '@/lib/diagnostics/heap-probe';

function readRendererStats(): RendererStats | null {
  const viewer = useSpeckleEngineStore.getState().viewer;
  const gl = viewer?.getRenderer()?.renderer;
  if (!gl) return null;
  return {
    programs: gl.info.programs?.length ?? 0,
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    calls: gl.info.render.calls,
    triangles: gl.info.render.triangles,
  };
}

export function useCrashProbe(orchestrator: AudioOrchestrator | null): void {
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;

  useEffect(() => {
    if (!isCrashProbeEnabled()) return;
    const stopProbe = startCrashProbe({
      getAudioStats: () => orchestratorRef.current?.getMemoryStats() ?? null,
      getLightStats: () =>
        useSpeckleEngineStore.getState().coordinator?.getSoundSphereManager()?.getLightStats() ?? null,
      getRendererStats: readRendererStats,
      getCanvas: () => useSpeckleEngineStore.getState().viewer?.getRenderer()?.renderer?.domElement ?? null,
      getExtraStats: () => ({
        calls: takeHeapProbeStats(),
        filter: readFilterStateStats(useSpeckleEngineStore.getState().viewer),
      }),
    });

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
