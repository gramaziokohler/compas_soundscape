/**
 * Backend post-effect render helpers for the FX panel.
 *
 * Noise Reduction and Trim Silence are server-rendered stages: the browser
 * bounces the FX chain up to (but not including) the stage, uploads it to
 * `/api/audio/post-process`, and caches the returned WAV URL in the instance
 * params (`renderedUrl`). Save threads that result through the remaining
 * effects, exactly like the Stable Audio stages.
 *
 * The decoded source buffer is shared with the Stable Audio stages (registered
 * by soundId in lib/audio/fx/stable-audio-render.ts).
 */

import { apiService } from '@/services/api';
import { audioBufferToWavBlob24 } from '@/lib/audio/utils/wav-encode';
import type { FxChain, FxInstance } from './fx-types';

/** The instance subset handled by this module. */
export type ServerPostInstance = Extract<
  FxInstance,
  { type: 'noiseReduction' | 'trimSilence' }
>;

/** Canonical signature of the inputs that affect a server post-effect render. */
export function serverPostSignature(instance: ServerPostInstance, preChain: FxChain): string {
  const params = instance.params;
  return JSON.stringify({
    kind: instance.type,
    reduction: 'reduction' in params ? params.reduction : undefined,
    pre: preChain.instances.map((i) => ({ type: i.type, enabled: i.enabled, params: i.params })),
  });
}

export interface ProcessServerPostArgs {
  instance: ServerPostInstance;
  /** Instances before this stage (applied to the source first). */
  preChain: FxChain;
  sourceBuffer: AudioBuffer;
}

/**
 * Bounce the pre-chain, upload it, and return the processed static URL.
 */
export async function processServerPost({
  instance,
  preChain,
  sourceBuffer,
}: ProcessServerPostArgs): Promise<string> {
  let preRendered = sourceBuffer;
  if (preChain.instances.length > 0) {
    const { renderFxToBuffer } = await import('./fx-render');
    preRendered = await renderFxToBuffer(sourceBuffer, {
      instances: preChain.instances,
      outputGainDb: 0,
    });
  }
  const blob = audioBufferToWavBlob24(preRendered);

  const noiseParams = instance.type === 'noiseReduction' ? instance.params : null;
  const { url } = await apiService.postProcessAudio(blob, {
    noiseReduction: noiseParams !== null,
    reduction: noiseParams?.reduction,
    trimSilence: instance.type === 'trimSilence',
  });
  return url;
}
