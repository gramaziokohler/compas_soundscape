import { SOUND_FX } from '@/utils/constants';

const loaded = new WeakSet<BaseAudioContext>();
const inflight = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Idempotent AudioWorklet module load. Safe to call for both live AudioContext
 * and OfflineAudioContext; subsequent calls on the same context no-op.
 *
 * Loads every FX worklet module (gate + pitch) in one shot.
 */
export async function ensureFxWorklet(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return true;
  const existing = inflight.get(ctx);
  if (existing) {
    try {
      await existing;
      return loaded.has(ctx);
    } catch {
      return false;
    }
  }

  if (!('audioWorklet' in ctx)) return false;

  const promise = (async () => {
    await ctx.audioWorklet.addModule(SOUND_FX.WORKLET_URL);
    await ctx.audioWorklet.addModule(SOUND_FX.PITCH_WORKLET_URL);
    loaded.add(ctx);
  })();
  inflight.set(ctx, promise);

  try {
    await promise;
    return true;
  } catch (err) {
    console.warn('[fx-worklet] Failed to load FX worklets:', err);
    inflight.delete(ctx);
    return false;
  }
}

export const FX_WORKLET_PROCESSOR = 'fx-dynamics-processor';
export const FX_PITCH_PROCESSOR = 'fx-pitch-processor';
