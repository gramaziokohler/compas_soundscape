import { describe, it, expect, vi } from 'vitest';
import { MEMORY_UNITS } from '@/utils/constants';
import { IRCache } from './ir-cache';

/** Minimal AudioBuffer stand-in: the cache only reads length and numberOfChannels. */
function fakeBuffer(megabytes: number): AudioBuffer {
  const length = (megabytes * MEMORY_UNITS.BYTES_PER_MB) / MEMORY_UNITS.BYTES_PER_SAMPLE;
  return { length, numberOfChannels: 1 } as AudioBuffer;
}

const loader = (mb: number) => vi.fn(() => Promise.resolve(fakeBuffer(mb)));
const MB = MEMORY_UNITS.BYTES_PER_MB;

describe('IRCache', () => {
  it('decodes each id once and shares concurrent requests', async () => {
    const cache = new IRCache(100 * MB);
    const load = loader(1);
    const [a, b] = await Promise.all([cache.get('ir', load), cache.get('ir', load)]);
    expect(a).toBe(b);
    await cache.get('ir', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ count: 1, decodes: 1, redecodes: 0, inFlight: 0 });
  });

  it('evicts the least recently used IR over budget', async () => {
    const cache = new IRCache(3 * MB);
    await cache.get('a', loader(1));
    await cache.get('b', loader(1));
    await cache.get('c', loader(1));
    await cache.get('a', loader(1)); // touch: b is now the oldest
    await cache.get('d', loader(1));
    const reloadB = loader(1);
    const reloadA = loader(1);
    await cache.get('a', reloadA);
    expect(reloadA).not.toHaveBeenCalled();
    await cache.get('b', reloadB);
    expect(reloadB).toHaveBeenCalledTimes(1);
    expect(cache.stats().redecodes).toBe(1);
  });

  it('never evicts pinned IRs, even over budget', async () => {
    const cache = new IRCache(2 * MB);
    await cache.get('playing-1', loader(1));
    await cache.get('playing-2', loader(1));
    cache.pin(['playing-1', 'playing-2']);
    await cache.get('other', loader(1));
    const again = loader(1);
    await cache.get('playing-1', again);
    expect(again).not.toHaveBeenCalled();
  });

  it('shrinkToPinned drops everything else; pin(merge) keeps the previous pins', async () => {
    const cache = new IRCache(100 * MB);
    await cache.get('old', loader(1));
    await cache.get('new', loader(1));
    await cache.get('spare', loader(1));
    cache.pin(['old']);
    cache.pin(['new'], true);
    cache.shrinkToPinned();
    expect(cache.stats().count).toBe(2);
  });

  it('a failed load is not cached and can be retried', async () => {
    const cache = new IRCache(100 * MB);
    await expect(cache.get('x', () => Promise.reject(new Error('404')))).rejects.toThrow('404');
    const retry = loader(1);
    await cache.get('x', retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
