import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('mapWithConcurrency', () => {
  it('maps every item and preserves input order', async () => {
    const { results, errors } = await mapWithConcurrency(
      [3, 1, 2],
      async (n) => {
        await new Promise((r) => setTimeout(r, n * 5));
        return n * 10;
      },
      2,
    );
    expect(errors).toEqual([]);
    expect(results).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        return undefined;
      },
      3,
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('isolates per-item failures and keeps the rest', async () => {
    const { results, errors } = await mapWithConcurrency(
      [1, 2, 3, 4],
      async (n) => {
        if (n % 2 === 0) throw new Error(`bad ${n}`);
        return n;
      },
      2,
    );
    expect(results).toEqual([1, 3]);
    expect(errors.map((e) => (e.error as Error).message).sort()).toEqual(['bad 2', 'bad 4']);
  });

  it('stops scheduling new items after an abort but awaits in-flight work', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const gate = deferred<void>();

    const run = mapWithConcurrency(
      [0, 1, 2, 3, 4],
      async (n) => {
        started.push(n);
        if (n === 0) {
          await gate.promise;
        }
        return n;
      },
      1,
      controller.signal,
    );

    controller.abort();
    gate.resolve();

    const { results } = await run;
    expect(results).toEqual([0]);
    expect(started).toEqual([0]);
  });
});
