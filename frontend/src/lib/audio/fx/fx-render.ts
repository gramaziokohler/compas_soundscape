/**
 * Offline bounce of a Foley FX chain through the same graph builder used live.
 */

import { SOUND_FX } from '@/utils/constants';
import { audioBufferToWavBlob24 } from '@/lib/audio/utils/wav-encode';
import { FxGraph } from './fx-graph';
import { mergeFxRegions, type FxChain } from './fx-types';

export interface RenderFxOptions {
  sampleRate?: number;
  /** Force mono output (used for the cheap display-waveform bounce). */
  mono?: boolean;
}

async function renderFxBuffer(
  buffer: AudioBuffer,
  chain: FxChain,
  opts: RenderFxOptions = {},
): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? buffer.sampleRate;
  const channels = opts.mono ? 1 : Math.min(2, buffer.numberOfChannels);

  // Regions are a keep-list that becomes the *output*: the selected parts are
  // cropped and glued back-to-back (no silent gaps, shorter file), so the saved
  // sample's duration is the sum of the regions.
  const segments = mergeFxRegions(chain.regions)
    .map((r) => ({ start: r.start * buffer.duration, end: r.end * buffer.duration }))
    .filter((r) => r.end - r.start > 1e-4);
  const hasRegions = segments.length > 0;
  const outDuration = hasRegions
    ? segments.reduce((acc, r) => acc + (r.end - r.start), 0)
    : buffer.duration;
  const length = Math.max(1, Math.ceil(outDuration * sampleRate));
  const offline = new OfflineAudioContext(channels, length, sampleRate);

  const sourceBuffer = sampleRate === buffer.sampleRate && (!opts.mono || buffer.numberOfChannels === 1)
    ? buffer
    : resampleForOffline(buffer, offline, channels, length, sampleRate);

  const graph = new FxGraph(offline);
  await graph.buildChain(chain);
  // The graph's output is a plain GainNode — the live engine wires it to the
  // destination, but the offline context must be wired here too or the bounce
  // renders silence.
  graph.output.connect(offline.destination);

  if (hasRegions) {
    let when = 0;
    for (const seg of segments) {
      const dur = seg.end - seg.start;
      const src = offline.createBufferSource();
      src.buffer = sourceBuffer;
      src.connect(graph.input);
      src.start(when, seg.start, dur);
      when += dur;
    }
  } else {
    const src = offline.createBufferSource();
    src.buffer = sourceBuffer;
    src.connect(graph.input);
    src.start(0);
  }

  const rendered = await offline.startRendering();
  graph.dispose();
  return rendered;
}

function resampleForOffline(
  buffer: AudioBuffer,
  offline: OfflineAudioContext,
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const tmp = offline.createBuffer(channels, length, sampleRate);
  const ratio = buffer.sampleRate / sampleRate;
  for (let c = 0; c < channels; c++) {
    const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
    const dst = tmp.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const srcIdx = i * ratio;
      const i0 = Math.floor(srcIdx);
      const i1 = Math.min(src.length - 1, i0 + 1);
      const t = srcIdx - i0;
      dst[i] = src[i0] * (1 - t) + src[i1] * t;
    }
  }
  return tmp;
}

/** Full-rate bounce used on Save. Preview and saved file share this path. */
export async function renderFxToWav(buffer: AudioBuffer, chain: FxChain): Promise<Blob> {
  const rendered = await renderFxBuffer(buffer, chain);
  return audioBufferToWavBlob24(rendered);
}

export async function renderFxToBuffer(buffer: AudioBuffer, chain: FxChain, opts?: RenderFxOptions): Promise<AudioBuffer> {
  return renderFxBuffer(buffer, chain, opts);
}

let displayTimer: ReturnType<typeof setTimeout> | null = null;
let displayGen = 0;

/**
 * Debounced, downsampled bounce for the *display* waveform only.
 * Never used for audible preview (that's the live engine).
 */
export function scheduleDisplayRender(
  buffer: AudioBuffer,
  chain: FxChain,
  onResult: (rendered: AudioBuffer) => void,
): () => void {
  const gen = ++displayGen;
  if (displayTimer) clearTimeout(displayTimer);
  displayTimer = setTimeout(() => {
    void renderFxBuffer(buffer, chain, {
      sampleRate: SOUND_FX.DISPLAY_RENDER_SAMPLE_RATE,
      mono: true,
    }).then((rendered) => {
      if (gen === displayGen) onResult(rendered);
    }).catch((err) => {
      console.warn('[fx-render] display bounce failed:', err);
    });
  }, SOUND_FX.DISPLAY_RENDER_DEBOUNCE_MS);

  return () => {
    if (displayTimer) clearTimeout(displayTimer);
    displayGen += 1;
  };
}
