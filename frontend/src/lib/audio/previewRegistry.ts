import type WaveSurfer from 'wavesurfer.js';

/**
 * Live WaveSurfer instances behind currently-mounted preview players, keyed by
 * the same synthetic preview key used for `audioControlsStore.previewingSoundId`
 * (raw soundId for generated sounds, `pregen:<index>` / `context-audio:<index>`
 * for pre-generation previews).
 *
 * Stopping a preview must pause the real WaveSurfer instance imperatively and
 * synchronously — React state changes (previewingSoundId → null, card removal,
 * card collapse) can all land in the same commit as an unmount, so a prop-driven
 * `isPlaying=false` effect may never get a chance to run before `ws.destroy()`
 * fires, which does not reliably stop in-flight WebAudio playback.
 */
const instances = new Map<string, WaveSurfer>();

export function registerPreviewInstance(key: string, ws: WaveSurfer | null): void {
  if (ws) instances.set(key, ws);
  else instances.delete(key);
}

export function pausePreviewInstance(key: string): void {
  const ws = instances.get(key);
  if (!ws) return;
  try { ws.pause(); } catch { /* ignore */ }
}

export function pauseAllPreviewInstances(): void {
  instances.forEach((ws) => {
    try { ws.pause(); } catch { /* ignore */ }
  });
}

/**
 * Smoothed-ish realtime level (0..1) of a preview player by reading the RMS of
 * its decoded buffer around the current playhead. Preview playback goes through
 * WaveSurfer (not the AudioOrchestrator), so there is no shared AnalyserNode to
 * tap; reading the decoded samples is accurate enough for a light/reactivity
 * pulse and does not mutate the audio graph.
 */
export function getPreviewLevel(key: string): number {
  const ws = instances.get(key);
  if (!ws) return 0;
  try {
    const buffer = ws.getDecodedData();
    if (!buffer) return 0;

    const sr = buffer.sampleRate;
    const t = ws.getCurrentTime();
    const start = Math.max(0, Math.floor((t - 0.05) * sr));
    const end = Math.min(buffer.length, Math.floor((t + 0.01) * sr));
    if (end <= start) return 0;

    const channel = buffer.getChannelData(0);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / (end - start));
    return Math.min(1, rms * 3.5);
  } catch {
    return 0;
  }
}
