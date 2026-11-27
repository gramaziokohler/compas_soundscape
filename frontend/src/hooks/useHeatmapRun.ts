'use client';

import { useCallback, useMemo } from 'react';
import {
  useAcousticsSimulationStore,
  useAudioControlsStore,
  useHeatmapListenersStore,
  useSoundscapeStore,
  useUIStore,
} from '@/store';
import { CARD_TYPE_LABELS } from '@/types/card';
import { isEngineSimulation, type SimulationConfig } from '@/types/acoustics';
import { HEATMAP_LISTENER_CONFIG } from '@/utils/constants';
import { buildCardGeometryRequest, simulationRequestSignature, type SimulationGeometryRequest } from '@/utils/simulationRequest';
import { soundsInActiveScene } from '@/lib/audio/utils/mute-solo';
import type { SoundDirectivity } from '@/types/directivity';
import type { HeatmapListenerData, HeatmapRunState } from '@/types/heatmap';
import type { PendingHeatmapResult } from '@/store';

/** The fields of a soundscape event a heatmap reads (the store types them loosely). */
export interface HeatmapSound {
  id: string;
  position: [number, number, number];
  prompt_index?: number;
  copy_index?: number;
  directivity?: SoundDirectivity;
  isPending?: boolean;
  volume_dbfs?: number;
}

/** Receiver id of the one placeholder receiver each source is paired with (the backend maps points, not pairs). */
const HEATMAP_RECEIVER_ID = 'heatmap';

type Prepared =
  | { ok: true; request: SimulationGeometryRequest; config: SimulationConfig; signature: string }
  | { ok: false; error: string };

/** Sounds of the active sound scene (every one: mute / solo are applied live, not at run time). */
export function useHeatmapSceneSounds(): HeatmapSound[] {
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData) as HeatmapSound[] | null;
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  return useMemo(
    () => soundsInActiveScene(soundscapeData ?? [], soundConfigs ?? [], activeSoundParentIndex)
      .filter((s) => !s.isPending && Array.isArray(s.position) && s.position.length === 3),
    [soundscapeData, soundConfigs, activeSoundParentIndex],
  );
}

/** posKey → every sound id (all variants) it stands for. */
function sourceSoundsOf(request: SimulationGeometryRequest): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  request.sourceSoundToPosKey.forEach((posKey, soundId) => {
    (out[posKey] ??= []).push(soundId);
  });
  return out;
}

/**
 * Run state + inputs of a heatmap card.
 *
 * The heatmap maps the **active simulation card** (the powered one): its geometry,
 * materials, scattering, acoustic region and the global mesh settings, with every
 * sound of the active scene as a source. `isOutdated` compares the stored result's
 * signature with the live inputs.
 */
export function useHeatmapRun(heatmap: HeatmapListenerData) {
  const activeIndex = useAcousticsSimulationStore((s) => s.activeSimulationIndex);
  const activeConfig = useAcousticsSimulationStore((s) =>
    s.activeSimulationIndex !== null ? s.simulationConfigs[s.activeSimulationIndex] ?? null : null,
  );
  const speckleUrl = useUIStore((s) => (s.globalSpeckleData as { url?: string } | null)?.url);
  const meshSettings = useUIStore((s) => s.simulationMeshSettings);
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const sounds = useHeatmapSceneSounds();
  const run = useHeatmapListenersStore((s) => s.runs[heatmap.id]) as HeatmapRunState | undefined;
  const result = useHeatmapListenersStore((s) => s.results[heatmap.id]);

  const activeCardName = activeConfig
    ? activeConfig.display_name || CARD_TYPE_LABELS[activeConfig.type] || `Simulation ${(activeIndex ?? 0) + 1}`
    : null;

  const prepared = useMemo<Prepared>(() => {
    if (!activeConfig) return { ok: false, error: 'Activate a simulation card first' };
    if (!isEngineSimulation(activeConfig)) {
      return { ok: false, error: 'The active card has no geometry: activate a ray-tracing, wave or hybrid card' };
    }
    if (heatmap.points.length === 0) return { ok: false, error: 'Define the surface first' };
    if (heatmap.points.length > HEATMAP_LISTENER_CONFIG.MAX_POINTS) {
      return { ok: false, error: `Too many points (${heatmap.points.length}); increase the spacing` };
    }
    const built = buildCardGeometryRequest(activeConfig, {
      speckleUrl,
      receivers: [{ id: HEATMAP_RECEIVER_ID, position: heatmap.points[0] }],
      sounds,
      selectedVariants,
    });
    if (!built.ok) return built;
    const signature = simulationRequestSignature('pyroomacoustics', built.request, meshSettings)
      + JSON.stringify([activeConfig.id, heatmap.points]);
    return { ok: true, request: built.request, config: activeConfig, signature };
  }, [activeConfig, heatmap.points, speckleUrl, sounds, selectedVariants, meshSettings]);

  const isRunning = run?.status === 'running';
  const isOutdated = !!result && (!prepared.ok || prepared.signature !== result.signature);

  const start = useCallback(() => {
    if (!prepared.ok) return;
    const pending: PendingHeatmapResult = {
      simulationConfigId: prepared.config.id,
      signature: prepared.signature,
      sourceSounds: sourceSoundsOf(prepared.request),
    };
    void useHeatmapListenersStore.getState().runHeatmap({
      heatmapListenerId: heatmap.id,
      params: {
        request: prepared.request,
        meshSettings,
        modelId: prepared.request.modelId,
        points: heatmap.points,
      },
      pending,
    });
  }, [prepared, heatmap.id, heatmap.points, meshSettings]);

  const cancel = useCallback(() => {
    useHeatmapListenersStore.getState().cancelHeatmap(heatmap.id);
  }, [heatmap.id]);

  return {
    activeCardName,
    canRun: prepared.ok && !isRunning,
    disabledReason: prepared.ok ? undefined : prepared.error,
    run,
    result,
    isRunning,
    isOutdated,
    start,
    cancel,
  };
}
