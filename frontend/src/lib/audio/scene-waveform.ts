/**
 * Scene waveform envelope — a coarse "loudness over the scene timeline" used by
 * the Simple-mode waveform-ring bubble icon.
 *
 * Each generated sound contributes its decoded peak envelope (shared
 * `peaks-cache`, so nothing is decoded twice — the DAW reuses the same entries)
 * at every time it plays:
 *   - explicit timestamps (MM:SS) when authored by the scenario,
 *   - otherwise every (duration + interval) seconds,
 *   - background sounds (interval 0) loop across the whole scene.
 * Levels are weighted by dBFS, summed, and normalized to 0..1.
 * This approximates the DAW score without needing the active scene's
 * orchestrator state, so it works for every scene, not only the playing one.
 */

import { getAudioPeaks, type AudioPeaks } from '@/lib/audio/peaks-cache';
import { parseAuthoredSeconds } from '@/lib/audio/utils/timeline-utils';
import { API_BASE_URL, DEFAULT_DBFS } from '@/utils/constants';

export interface SceneWaveformSource {
  url: string;
  /** Explicit play times ("MM:SS" or seconds). */
  timestamps?: string[];
  /** Silence between repetitions (s); 0 = continuous background loop. */
  intervalSeconds?: number;
  dbfs?: number;
}

const DB_TO_AMP = 20;

function resolveUrl(url: string): string {
  return url.startsWith('blob:') || url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

/** Peak magnitude of `peaks` over the fraction range [a, b). */
function peakBetween(peaks: AudioPeaks, a: number, b: number): number {
  const n = peaks.max.length;
  const i0 = Math.max(0, Math.floor(a * n));
  const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(b * n)));
  let m = 0;
  for (let i = i0; i < i1; i++) m = Math.max(m, peaks.max[i], -peaks.min[i]);
  return m;
}

/** Start times (s) of every play of a source within the scene. */
function playTimes(src: SceneWaveformSource, durationSec: number, sceneSec: number): number[] {
  if (src.timestamps?.length) {
    return src.timestamps.map(parseAuthoredSeconds).filter((t) => t >= 0 && t < sceneSec);
  }
  const interval = src.intervalSeconds ?? 0;
  const period = Math.max(0.5, durationSec + Math.max(0, interval));
  const times: number[] = [];
  for (let t = 0; t < sceneSec; t += period) times.push(t);
  return times;
}

/**
 * Build a `bins`-long 0..1 envelope for the scene. Resolves to null when no
 * source could be decoded.
 */
export async function computeSceneEnvelope(
  sources: SceneWaveformSource[],
  sceneDurationMs: number,
  bins: number,
): Promise<number[] | null> {
  const sceneSec = Math.max(1, sceneDurationMs / 1000);
  const binSec = sceneSec / bins;
  const acc = new Float64Array(bins);
  let decoded = 0;

  const results = await Promise.all(
    sources.map(async (src) => ({ src, peaks: await getAudioPeaks(src.url, resolveUrl(src.url)) })),
  );

  for (const { src, peaks } of results) {
    if (!peaks || peaks.duration <= 0) continue;
    decoded++;
    const gain = Math.pow(10, (src.dbfs ?? DEFAULT_DBFS) / DB_TO_AMP);
    for (const start of playTimes(src, peaks.duration, sceneSec)) {
      const b0 = Math.floor(start / binSec);
      const b1 = Math.min(bins, Math.ceil((start + peaks.duration) / binSec));
      for (let b = b0; b < b1; b++) {
        const a = (b * binSec - start) / peaks.duration;
        const z = ((b + 1) * binSec - start) / peaks.duration;
        acc[b] += gain * peakBetween(peaks, Math.max(0, a), Math.min(1, z));
      }
    }
  }

  if (decoded === 0) return null;
  let max = 0;
  for (const v of acc) max = Math.max(max, v);
  if (max <= 0) return Array.from(acc, () => 0);
  return Array.from(acc, (v) => v / max);
}
