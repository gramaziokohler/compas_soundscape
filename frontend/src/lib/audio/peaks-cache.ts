/**
 * Shared audio peaks cache.
 *
 * The DAW timeline used to mount one full `WaveSurfer` instance per iteration
 * block — every block fetched and decoded its own copy of the audio (10 tracks x
 * 5 iterations = 50 fetches, 50 decodes, 50 canvases) purely to draw a static
 * thumbnail that never plays. This module decodes each audio URL exactly ONCE,
 * caches a compact min/max peak array, and lets any number of blocks referencing
 * the same URL draw from it via a plain `<canvas>` — no WaveSurfer, no per-block
 * network/decode cost.
 */

const PEAKS_RESOLUTION = 600; // peak pairs per waveform — enough detail at any DAW zoom level

export interface AudioPeaks {
  min: Float32Array;
  max: Float32Array;
  duration: number; // seconds
}

const cache = new Map<string, Promise<AudioPeaks | null>>();
let sharedDecodeContext: AudioContext | null = null;

function getDecodeContext(): AudioContext {
  if (!sharedDecodeContext) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedDecodeContext = new Ctor();
  }
  return sharedDecodeContext;
}

function computePeaks(buffer: AudioBuffer, resolution: number): AudioPeaks {
  const channelData = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channelData.length / resolution));
  const min = new Float32Array(resolution);
  const max = new Float32Array(resolution);

  for (let i = 0; i < resolution; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, channelData.length);
    let mn = 0;
    let mx = 0;
    for (let j = start; j < end; j++) {
      const v = channelData[j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    min[i] = mn;
    max[i] = mx;
  }

  return { min, max, duration: buffer.duration };
}

/**
 * Fetch + decode a URL's peaks exactly once. Concurrent/subsequent callers for
 * the same URL share the same in-flight promise (and then the cached result),
 * so N DAW blocks pointing at the same audio never re-fetch or re-decode.
 *
 * @param cacheKey - stable identity for the audio (usually the raw, unresolved URL)
 * @param resolvedUrl - the actual fetchable URL (with API base prepended, etc.)
 */
export function getAudioPeaks(cacheKey: string, resolvedUrl: string): Promise<AudioPeaks | null> {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<AudioPeaks | null> => {
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await getDecodeContext().decodeAudioData(arrayBuffer);
      return computePeaks(audioBuffer, PEAKS_RESOLUTION);
    } catch {
      return null;
    }
  })();

  cache.set(cacheKey, promise);
  return promise;
}

/** Clear the cache (rarely needed — mainly for tests or explicit memory reclamation). */
export function clearAudioPeaksCache(): void {
  cache.clear();
}
