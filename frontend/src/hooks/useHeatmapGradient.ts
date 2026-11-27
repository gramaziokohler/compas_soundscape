'use client';

import { useEffect, useMemo } from 'react';
import { useAudioControlsStore, useHeatmapListenersStore, useUIStore } from '@/store';
import { combineHeatmap, heatmapSourceLevels } from '@/lib/acoustics/heatmap-combine';
import { computeMuteSolo } from '@/lib/audio/utils/mute-solo';
import { collapseVariantsToOne } from '@/utils/positionKey';
import { DEFAULT_DBFS } from '@/utils/constants';
import { useHeatmapSceneSounds, type HeatmapSound } from './useHeatmapRun';
import type { HeatmapListenerData, HeatmapMetric } from '@/types/heatmap';

export interface HeatmapLevels {
  /** Level of each payload point (null = outside the room or no audible source). */
  points: Array<{ position: [number, number, number]; value: number | null }>;
  min: number | null;
  max: number | null;
  metric: HeatmapMetric;
  bands: number[];
}

/** Fader level of a sound, as the audio engine plays it (sound-card / DAW volume). */
function volumeResolver(
  sounds: readonly HeatmapSound[],
  soundVolumes: Readonly<Record<string, number>>,
): (soundId: string) => number | undefined {
  const byId = new Map(sounds.map((s) => [s.id, s]));
  // A fader moved on one variant applies to the whole prompt (useSpeckleAudioSync).
  const promptOverride = new Map<number, number>();
  for (const s of sounds) {
    const v = soundVolumes[s.id];
    if (v !== undefined && s.prompt_index != null && !promptOverride.has(s.prompt_index)) promptOverride.set(s.prompt_index, v);
  }
  return (id) => {
    const sound = byId.get(id);
    if (!sound) return undefined;
    return soundVolumes[id]
      ?? (sound.prompt_index != null ? promptOverride.get(sound.prompt_index) : undefined)
      ?? sound.volume_dbfs
      ?? DEFAULT_DBFS;
  };
}

/**
 * Live levels of a heatmap's result: its per-source map weighted by each sound's
 * volume, with muted / not-soloed sounds and unselected variants left out. Null
 * while there is no result or its payload is not loaded.
 */
export function useHeatmapLevels(heatmapId: string | null): HeatmapLevels | null {
  const result = useHeatmapListenersStore((s) => (heatmapId ? s.results[heatmapId] : undefined));
  const payload = useHeatmapListenersStore((s) => (result ? s.payloads[result.heatmapId] : undefined));
  const metric = useHeatmapListenersStore((s) => (heatmapId ? s.metrics[heatmapId] : undefined)) ?? 'spl_a';
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSounds = useAudioControlsStore((s) => s.soloedSounds);
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const sounds = useHeatmapSceneSounds();

  return useMemo(() => {
    if (!result || !payload) return null;
    const { silencedIds } = computeMuteSolo(sounds, mutedSounds, soloedSounds);
    // Only the selected variant of a prompt plays: the others count as silent.
    const playing = new Set(collapseVariantsToOne(sounds, selectedVariants).map((s) => s.id));
    const silent = new Set<string>(silencedIds);
    for (const s of sounds) if (!playing.has(s.id)) silent.add(s.id);

    const levels = heatmapSourceLevels(result.sourceSounds, volumeResolver(sounds, soundVolumes), silent);
    const values = combineHeatmap(payload, levels, metric);
    const finite = values.filter((v): v is number => v !== null);
    return {
      points: payload.points.map((position, i) => ({ position, value: values[i] })),
      min: finite.length ? Math.min(...finite) : null,
      max: finite.length ? Math.max(...finite) : null,
      metric,
      bands: payload.bands,
    };
  }, [result, payload, metric, sounds, soundVolumes, mutedSounds, soloedSounds, selectedVariants]);
}

/**
 * Draws the powered heatmap as the scene's gradient plane (GradientMapManager), and
 * redraws it whenever a volume, mute, solo, variant or the metric changes. Mounted
 * once, by the listeners section.
 */
export function useHeatmapGradient(): void {
  const activeHeatmapId = useHeatmapListenersStore((s) => s.activeHeatmapId);
  const heatmap = useHeatmapListenersStore((s) =>
    s.activeHeatmapId ? s.heatmapListeners.find((h) => h.id === s.activeHeatmapId) : undefined,
  ) as HeatmapListenerData | undefined;
  const levels = useHeatmapLevels(activeHeatmapId);

  useEffect(() => {
    const ui = useUIStore.getState();
    if (!activeHeatmapId) return;
    const pointValues = (levels?.points ?? [])
      .filter((p): p is { position: [number, number, number]; value: number } => p.value !== null);
    if (!heatmap?.boundingBox || pointValues.length === 0) {
      ui.clearGradientMap(activeHeatmapId);
      return;
    }
    ui.setActiveGradientMap({
      metric: 'spl',
      ownerId: activeHeatmapId,
      pointValues,
      boundingBox: heatmap.boundingBox,
    });
  }, [activeHeatmapId, heatmap?.boundingBox, levels]);

  // Power-off / removal: take the heatmap's plane down.
  useEffect(() => {
    if (!activeHeatmapId) return;
    return () => useUIStore.getState().clearGradientMap(activeHeatmapId);
  }, [activeHeatmapId]);
}
