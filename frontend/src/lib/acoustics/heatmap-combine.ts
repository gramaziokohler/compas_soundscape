/**
 * Heatmap level combination — pure, so a volume / mute / solo change only
 * recomputes numbers and never re-runs the EnergyMap job.
 *
 * The backend payload holds, per source s, point p and octave band b, the level
 * G[s][p][b] the source produces at 0 dB re 1 m. With the source's level Lw[s]
 * (dB SPL at 1 m), sources add in energy:
 *
 *   L[p][b] = 10·log10 Σ_s 10^((G[s][p][b] + Lw[s]) / 10)
 *
 * dB(A) sums the bands after IEC 61672 A-weighting.
 */

import { HEATMAP_LISTENER_CONFIG } from '@/utils/constants';
import type { HeatmapMetric, HeatmapPayload } from '@/types/heatmap';

const dbToEnergy = (db: number) => 10 ** (db / 10);
const energyToDb = (e: number) => 10 * Math.log10(e);

/**
 * Level of each point for `metric`, with each source at `sourceLevels[id]` dB re 1 m.
 * A source missing from `sourceLevels` (or null) is silent. A point outside the room,
 * or reached by no audible source, is null.
 */
export function combineHeatmap(
  payload: HeatmapPayload,
  sourceLevels: Readonly<Record<string, number | null | undefined>>,
  metric: HeatmapMetric,
): Array<number | null> {
  const bandWeights = payload.bands.map((f, b) => {
    if (metric === 'spl_a') return dbToEnergy(HEATMAP_LISTENER_CONFIG.A_WEIGHTS[f] ?? 0);
    return b === metric ? 1 : 0;
  });
  const audible = payload.sources
    .map((source) => ({ source, level: sourceLevels[source.id] }))
    .filter((s): s is { source: HeatmapPayload['sources'][number]; level: number } => typeof s.level === 'number');

  return payload.points.map((_, p) => {
    if (!payload.inside[p]) return null;
    let energy = 0;
    for (const { source, level } of audible) {
      const bands = source.spl_bands[p];
      if (!bands) continue;
      bands.forEach((g, b) => {
        if (g !== null && bandWeights[b] > 0) energy += bandWeights[b] * dbToEnergy(g + level);
      });
    }
    return energy > 0 ? energyToDb(energy) : null;
  });
}

/** Level (dB re 1 m) of a sound whose fader is at `volumeDbfs`. */
export function soundLevelAt1m(volumeDbfs: number): number {
  return HEATMAP_LISTENER_CONFIG.SPL_AT_0_DBFS + volumeDbfs;
}

/**
 * Level of every heatmap source: the energy sum of its audible sounds (several sounds
 * at one position are one simulated source). A source with no audible sound is null.
 */
export function heatmapSourceLevels(
  sourceSounds: Readonly<Record<string, readonly string[]>>,
  volumeOf: (soundId: string) => number | undefined,
  silencedIds: ReadonlySet<string>,
): Record<string, number | null> {
  const levels: Record<string, number | null> = {};
  for (const [sourceId, soundIds] of Object.entries(sourceSounds)) {
    let energy = 0;
    for (const id of soundIds) {
      if (silencedIds.has(id)) continue;
      const volume = volumeOf(id);
      if (volume === undefined) continue; // the sound was deleted since the run
      energy += dbToEnergy(soundLevelAt1m(volume));
    }
    levels[sourceId] = energy > 0 ? energyToDb(energy) : null;
  }
  return levels;
}
