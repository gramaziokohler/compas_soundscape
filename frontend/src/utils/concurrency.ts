/**
 * Bounded-concurrency async mapping.
 *
 * Used by the sound-generation lanes (ElevenLabs, calibration, library, catalog)
 * so a "Generate all" fans out across independent work items without unbounded
 * concurrency against an external API or the backend threadpool.
 */

export interface MapWithConcurrencyError<T> {
  item: T;
  index: number;
  error: unknown;
}

export interface MapWithConcurrencyResult<T, R> {
  /** Fulfilled values, in input order (failing entries are omitted). */
  results: R[];
  /** Per-item failures, in completion order. Never rejects the whole run. */
  errors: MapWithConcurrencyError<T>[];
}

/**
 * Run `worker` over `items` with at most `limit` calls in flight at once.
 *
 * Uses a sliding window (not fixed batches): as soon as one item finishes, the
 * next unstarted item begins — a slow item never blocks the rest of a batch.
 *
 * A failing item is caught and recorded in `errors`; it never rejects the run
 * and never prevents the remaining items from being processed. When `signal`
 * aborts, no further items are scheduled and already-started items are awaited,
 * so the caller always receives a consistent partial result.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  limit: number,
  signal?: AbortSignal,
): Promise<MapWithConcurrencyResult<T, R>> {
  const outcomes: Array<{ ok: true; value: R } | { ok: false } | undefined> =
    new Array(items.length);
  const errors: MapWithConcurrencyError<T>[] = [];
  const effectiveLimit = Math.max(1, Math.floor(limit));
  let nextIndex = 0;

  const pump = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;

      const item = items[current];
      try {
        const value = await worker(item, current);
        outcomes[current] = { ok: true, value };
      } catch (error) {
        errors.push({ item, index: current, error });
        outcomes[current] = { ok: false };
      }
    }
  };

  const workerCount = Math.min(effectiveLimit, items.length);
  const pumps: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    pumps.push(pump());
  }
  await Promise.all(pumps);

  const results: R[] = [];
  for (const outcome of outcomes) {
    if (outcome?.ok) results.push(outcome.value);
  }
  return { results, errors };
}
