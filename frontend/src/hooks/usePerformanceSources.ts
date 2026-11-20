/**
 * usePerformanceSources — wires the live audio engine, Sounds-view lights and the
 * Speckle WebGL renderer into the shared performance monitor. Called once from
 * page.tsx in every view; it only registers readers (through refs), so nothing is
 * sampled until a consumer (meter, crash probe, emergency guard) subscribes.
 */
import { useEffect, useRef } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { setPerformanceSources } from '@/lib/diagnostics/performance-monitor';
import type { RendererStats } from '@/types';

function readRendererStats(): RendererStats | null {
  const gl = useSpeckleEngineStore.getState().viewer?.getRenderer()?.renderer;
  if (!gl) return null;
  return {
    programs: gl.info.programs?.length ?? 0,
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    calls: gl.info.render.calls,
    triangles: gl.info.render.triangles,
  };
}

export function usePerformanceSources(orchestrator: AudioOrchestrator | null): void {
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;

  useEffect(() => {
    setPerformanceSources({
      getAudioStats: () => orchestratorRef.current?.getMemoryStats() ?? null,
      getContextHealth: () => orchestratorRef.current?.getContextHealth() ?? null,
      getPlayingVoices: () => orchestratorRef.current?.getPlayingSourceIds().length ?? 0,
      getLightStats: () =>
        useSpeckleEngineStore.getState().coordinator?.getSoundSphereManager()?.getLightStats() ?? null,
      getRendererStats: readRendererStats,
      getCanvas: () => useSpeckleEngineStore.getState().viewer?.getRenderer()?.renderer?.domElement ?? null,
    });
    return () => setPerformanceSources(null);
  }, []);
}
