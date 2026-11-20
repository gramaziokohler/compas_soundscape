/**
 * useCrashProbe — runs the `[dbg:crash-probe]` sampler (lib/diagnostics/crash-probe.ts)
 * while `?diag=1` is enabled in this browser. Reads the audio engine, the Sounds-view
 * lights and the Speckle WebGL renderer through refs, so it starts once and never
 * re-subscribes when the orchestrator or viewer instance changes.
 */
import { useEffect, useRef } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { isCrashProbeEnabled, startCrashProbe, type RendererStats } from '@/lib/diagnostics/crash-probe';

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
    return startCrashProbe({
      getAudioStats: () => orchestratorRef.current?.getMemoryStats() ?? null,
      getLightStats: () =>
        useSpeckleEngineStore.getState().coordinator?.getSoundSphereManager()?.getLightStats() ?? null,
      getRendererStats: readRendererStats,
      getCanvas: () => useSpeckleEngineStore.getState().viewer?.getRenderer()?.renderer?.domElement ?? null,
    });
  }, []);
}
