/**
 * Stable Audio 3 render helper for the FX panel.
 *
 * The Stable Audio effect is a server-rendered stage: the browser bounces the
 * FX chain up to (but not including) the stage, uploads it, and polls the `sa3`
 * job. The generated WAV URL is stored on the instance params and threaded
 * through the remaining effects on Save.
 *
 * AudioBuffers are non-serializable and cannot live in Zustand, so the decoded
 * source buffer is registered here in a module-level map keyed by soundId.
 */

import { STABLE_AUDIO_MODES } from '@/utils/constants';
import { apiService } from '@/services/api';
import { audioBufferToWavBlob24 } from '@/lib/audio/utils/wav-encode';
import { isStableAudioInstance, type FxChain, type FxInstance, type FxRegion, type StableAudioModeName, type StableAudioParams } from './fx-types';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 15 * 60 * 1000;

const sourceBuffers = new Map<string, AudioBuffer>();

export function registerStableAudioSource(soundId: string, buffer: AudioBuffer): void {
  sourceBuffers.set(soundId, buffer);
}

export function getStableAudioSource(soundId: string): AudioBuffer | null {
  return sourceBuffers.get(soundId) ?? null;
}

export function clearStableAudioSource(soundId: string): void {
  sourceBuffers.delete(soundId);
}

/** Canonical signature of the inputs that affect a Stable Audio render. */
export function stableAudioSignature(
  params: StableAudioParams,
  preChain: FxChain,
  mode: StableAudioModeName,
): string {
  return JSON.stringify({
    mode,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    strength: params.strength,
    steps: params.steps,
    cfgScale: params.cfgScale,
    seed: params.seed,
    regions: params.regions,
    duration: params.duration,
    durationPaddingSec: params.durationPaddingSec,
    pre: preChain.instances.map((i) => ({ type: i.type, enabled: i.enabled, params: i.params })),
  });
}

export interface GenerateStableAudioArgs {
  soundId: string;
  mode: StableAudioModeName;
  params: StableAudioParams;
  /** Instances before the Stable Audio stage (applied to the source first). */
  preChain: FxChain;
  sourceBuffer: AudioBuffer;
  onProgress?: (progress: number, status: string) => void;
  signal?: AbortSignal;
}

/**
 * Bounce the pre-chain, upload it, enqueue the `sa3` job and poll until done.
 * Returns the generated static URL.
 */
export async function generateStableAudio({
  soundId,
  mode,
  params,
  preChain,
  sourceBuffer,
  onProgress,
  signal,
}: GenerateStableAudioArgs): Promise<string> {
  void soundId;
  const srcDuration = sourceBuffer.duration;

  // 1. Render the FX stages before Stable Audio (crop regions intentionally not
  //    applied — the inpaint mask is expressed on the source timeline).
  let preRendered = sourceBuffer;
  if (preChain.instances.length > 0) {
    const { renderFxToBuffer } = await import('./fx-render');
    preRendered = await renderFxToBuffer(sourceBuffer, {
      instances: preChain.instances,
      outputGainDb: 0,
    });
  }
  const blob = audioBufferToWavBlob24(preRendered);

  // 2. Resolve the target duration + inpaint regions (seconds).
  let duration = srcDuration;
  let regionsSec: [number, number][] = [];
  if (mode === STABLE_AUDIO_MODES.EXTEND) {
    duration = Math.max(params.duration, srcDuration + 0.5);
    regionsSec = [[srcDuration, duration]];
  } else if (mode === STABLE_AUDIO_MODES.INPAINT) {
    regionsSec = params.regions
      .filter((r: FxRegion) => r.end > r.start)
      .map((r: FxRegion) => [r.start * srcDuration, r.end * srcDuration] as [number, number]);
  }

  // 3. Enqueue + poll.
  const { job_id } = await apiService.stableAudioTransform(blob, {
    mode,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    strength: params.strength,
    steps: params.steps,
    cfgScale: params.cfgScale,
    seed: params.seed,
    duration,
    regions: regionsSec,
    durationPaddingSec: params.durationPaddingSec,
    samplerType: 'pingpong',
  });
  onProgress?.(0, 'Queued');

  const started = Date.now();
  for (;;) {
    if (signal?.aborted) {
      await apiService.cancelSoundGeneration(job_id).catch(() => {});
      throw new Error('Stable Audio generation cancelled');
    }
    if (Date.now() - started > POLL_MAX_MS) {
      throw new Error('Stable Audio generation timed out');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const status = await apiService.getSoundGenerationStatus(job_id);
    onProgress?.(status.progress ?? 0, status.status);
    if (status.cancelled) throw new Error('Stable Audio generation cancelled');
    if (status.error) throw new Error(status.error);
    if (status.completed) {
      const url = status.result?.[0]?.url;
      if (!url) throw new Error('Stable Audio returned no audio');
      return url as string;
    }
  }
}

/**
 * Render a chain that may contain Stable Audio stages to a WAV blob.
 *
 * Instances are processed in order: local effects accumulate until a Stable
 * Audio stage is hit (then the accumulated buffer is bounced), the stage's
 * `renderedUrl` is decoded and becomes the new source, and so on. Crop regions
 * + output gain are applied last across the whole result.
 */
export async function renderFxChainToWav(
  buffer: AudioBuffer,
  chain: FxChain,
  decodeUrl: (url: string, name: string) => Promise<AudioBuffer>,
): Promise<Blob> {
  const { renderFxToBuffer } = await import('./fx-render');

  let current = buffer;
  let pending: FxInstance[] = [];
  const flush = async () => {
    if (pending.length === 0) return;
    current = await renderFxToBuffer(current, { instances: pending, outputGainDb: 0 });
    pending = [];
  };

  for (const inst of chain.instances) {
    if (isStableAudioInstance(inst)) {
      await flush();
      if (!inst.enabled) continue;
      const url = inst.params.renderedUrl;
      if (!url) throw new Error('Generate the Stable Audio stage before saving');
      current = await decodeUrl(url, 'stable-audio');
    } else {
      pending.push(inst);
    }
  }
  await flush();

  // Apply the crop regions + global output gain across the whole result.
  current = await renderFxToBuffer(current, {
    instances: [],
    regions: chain.regions,
    outputGainDb: chain.outputGainDb,
  });
  return audioBufferToWavBlob24(current);
}

export function chainHasStableAudio(chain: FxChain): boolean {
  return chain.instances.some((i) => isStableAudioInstance(i));
}
