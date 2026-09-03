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
