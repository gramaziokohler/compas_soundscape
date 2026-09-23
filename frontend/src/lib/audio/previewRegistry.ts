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
 *
 * A single preview key can back more than one mounted WaveSurfer at once — e.g.
 * the sound card in the Sounds step AND the same sound mirrored in the
 * EntityInfoPanel context menu. Stopping a preview must pause ALL of them, so
 * the registry keeps a list per key rather than a single instance.
 */
const instances = new Map<string, WaveSurfer[]>();

// Shared playhead per preview key. The same preview (e.g. a generated sound)
// can be mounted in the Sounds-step card AND mirrored in the EntityInfoPanel;
// seeking either one must move the other, and a player that mounts later must
// pick up the current playhead.
const positions = new Map<string, number>();

export function registerPreviewInstance(key: string, ws: WaveSurfer | null): void {
  if (!ws) {
    instances.delete(key);
    return;
  }
  const list = instances.get(key) ?? [];
  if (!list.includes(ws)) list.push(ws);
  instances.set(key, list);
}

export function unregisterPreviewInstance(key: string, ws: WaveSurfer): void {
  const list = instances.get(key);
  if (!list) return;
  const next = list.filter((entry) => entry !== ws);
  if (next.length > 0) instances.set(key, next);
  else instances.delete(key);
}

/** Current shared playhead (seconds) for a preview key, if any player set it. */
export function getPreviewPosition(key: string): number | undefined {
  return positions.get(key);
}

/**
 * Seek every mounted player of a preview key to `time`. The player that already
 * sits at that time (the seek source) is skipped, so propagation is idempotent
 * and cannot loop.
 */
export function seekPreviewInstances(key: string, time: number): void {
  positions.set(key, time);
  const list = instances.get(key);
  if (!list) return;
  list.forEach((ws) => {
    try {
      const dur = ws.getDuration();
      if (dur <= 0) return;
      const target = Math.min(Math.max(time, 0), dur);
      if (Math.abs(ws.getCurrentTime() - target) > 0.08) ws.setTime(target);
    } catch { /* ignore */ }
  });
}

export function pausePreviewInstance(key: string): void {
  const list = instances.get(key);
  if (!list) return;
  list.forEach((ws) => {
    try { ws.pause(); } catch { /* ignore */ }
  });
}

export function pauseAllPreviewInstances(): void {
  instances.forEach((list) => {
    list.forEach((ws) => {
      try { ws.pause(); } catch { /* ignore */ }
    });
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
  const list = instances.get(key);
  const ws = list?.[list.length - 1];
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
