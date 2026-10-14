/**
 * Idempotent AudioWorklet module loading.
 *
 * `audioWorklet.addModule()` must run once per context per module; this
 * tracks loaded and in-flight URLs per context so callers can simply await
 * `ensureWorkletModules(ctx, urls)` before creating their AudioWorkletNodes.
 * Works for live AudioContext and OfflineAudioContext.
 */

const loaded = new WeakMap<BaseAudioContext, Set<string>>();
const inflight = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

async function ensureOne(ctx: BaseAudioContext, url: string): Promise<void> {
  const done = loaded.get(ctx) ?? new Set<string>();
  loaded.set(ctx, done);
  if (done.has(url)) return;

  const pending = inflight.get(ctx) ?? new Map<string, Promise<void>>();
  inflight.set(ctx, pending);
  const existing = pending.get(url);
  if (existing) return existing;

  const promise = ctx.audioWorklet.addModule(url).then(() => {
    done.add(url);
  });
  pending.set(url, promise);
  try {
    await promise;
  } finally {
    pending.delete(url);
  }
}

/**
 * Load every module in `urls` on `ctx` (in order), once.
 * @returns false when AudioWorklet is unavailable or a module failed to load
 */
export async function ensureWorkletModules(ctx: BaseAudioContext, urls: readonly string[]): Promise<boolean> {
  if (!('audioWorklet' in ctx)) return false;
  try {
    for (const url of urls) {
      await ensureOne(ctx, url);
    }
    return true;
  } catch (err) {
    console.warn('[worklet-loader] Failed to load worklet modules:', urls, err);
    return false;
  }
}
