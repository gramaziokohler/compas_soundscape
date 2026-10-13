/**
 * Global (non-spatial) sources
 *
 * Background beds play in the DAW mix without direction or distance
 * attenuation, but still go through the room (IR convolution / Resonance room).
 * In the ambisonic modes a global source is encoded omnidirectionally: only the
 * W channel carries signal, scaled by GLOBAL_SOURCE.OMNI_LEVEL_GAIN so it is as
 * loud as the same sound placed as a point source at the 1 m reference distance.
 * The bus stays ACN/SN3D, so binaural and the multichannel send both get it.
 *
 * Global rendering never touches the stored source position: switching back to
 * spatial re-encodes from the position the sphere still holds.
 */

import type { AmbisonicOrder } from '@/types/audio';
import { GLOBAL_SOURCE, normalizeSoundCategory } from '@/utils/constants';
import type { AmbisonicGainEncoder } from './ambisonic-utils';

/** True for sound categories that can play as global sources (background beds). */
export function isGlobalSoundCategory(category?: string | null): boolean {
  return normalizeSoundCategory(category) === 'background';
}

/**
 * Whether a card plays as a global bed: background cards only, following the
 * card's own toggle (`global_playback`, unset = GLOBAL_SOURCE.DEFAULT_ENABLED).
 */
export function isConfigGlobal(config: { category?: string | null; global_playback?: boolean }): boolean {
  return isGlobalSoundCategory(config.category)
    && (config.global_playback ?? GLOBAL_SOURCE.DEFAULT_ENABLED);
}

/** W gain for an omni encoding at `order` (see GLOBAL_SOURCE.OMNI_LEVEL_GAIN). */
export function omniLevelGain(order: AmbisonicOrder): number {
  return GLOBAL_SOURCE.OMNI_LEVEL_GAIN[order];
}

/** Ambisonic order implied by an ACN channel count ((order + 1)² channels). */
function orderFromChannelCount(channels: number): AmbisonicOrder {
  const order = Math.round(Math.sqrt(channels)) - 1;
  return (order >= 3 ? 3 : order <= 1 ? 1 : 2) as AmbisonicOrder;
}

/**
 * Overwrite a JSAmbisonics monoEncoder's gains with an omni encoding:
 * W = omni level gain, every directional channel 0. Use it instead of
 * `updateGains()` + `applySn3dToEncoder()` for a global source.
 */
export function applyOmniToEncoder(encoder: AmbisonicGainEncoder, order: AmbisonicOrder): void {
  encoder.gainNodes[0].gain.value = omniLevelGain(order);
  for (let ch = 1; ch < encoder.gainNodes.length; ch++) {
    encoder.gainNodes[ch].gain.value = 0;
  }
}

/**
 * Omni version of an ambisonic (ACN/SN3D) filter for a global source: keeps the
 * W channel — the room's omnidirectional response, reverb included — scaled by
 * the omni level gain, and zeroes the directional channels. Channel count is
 * unchanged so the same convolver order accepts it.
 */
export function toOmniFilter(context: BaseAudioContext, filter: AudioBuffer): AudioBuffer {
  const omni = context.createBuffer(filter.numberOfChannels, filter.length, filter.sampleRate);
  const gain = omniLevelGain(orderFromChannelCount(filter.numberOfChannels));
  const source = filter.getChannelData(0);
  const target = omni.getChannelData(0);
  for (let i = 0; i < source.length; i++) target[i] = source[i] * gain;
  return omni;
}
