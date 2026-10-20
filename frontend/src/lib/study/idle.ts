/**
 * Run `fn` when the main thread is idle (bounded by `timeoutMs`), so study
 * bookkeeping never competes with a play press, a drag or a render.
 * Falls back to a timer where requestIdleCallback is unavailable.
 */
export function scheduleIdle(fn: () => void, timeoutMs: number): void {
  const run = () => {
    try {
      fn();
    } catch {
      // study bookkeeping must never surface errors
    }
  };
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: timeoutMs });
  } else {
    setTimeout(run, 1);
  }
}
