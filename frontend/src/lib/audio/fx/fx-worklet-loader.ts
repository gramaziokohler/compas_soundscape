import { SOUND_FX } from '@/utils/constants';
import { ensureWorkletModules } from '../utils/worklet-loader';

/**
 * Idempotent AudioWorklet module load. Safe to call for both live AudioContext
 * and OfflineAudioContext; subsequent calls on the same context no-op.
 *
 * Loads every FX worklet module (gate + pitch) in one shot.
 */
export async function ensureFxWorklet(ctx: BaseAudioContext): Promise<boolean> {
  return ensureWorkletModules(ctx, [SOUND_FX.WORKLET_URL, SOUND_FX.PITCH_WORKLET_URL]);
}

export const FX_WORKLET_PROCESSOR = 'fx-dynamics-processor';
export const FX_PITCH_PROCESSOR = 'fx-pitch-processor';
