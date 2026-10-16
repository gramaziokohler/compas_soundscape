/**
 * Live index refs
 *
 * Cards are addressed by array index, and those indices shift when another card
 * is inserted or removed. Async work that outlives a single tick (an LLM poll, a
 * generation lane) must therefore not keep a captured index: it holds a
 * LiveIndexRef instead, which the owning store remaps alongside every other
 * index link. `current === null` means the card was removed.
 *
 * Usage:
 * ```ts
 * const refs = createLiveIndexRegistry();
 * const ref = refs.track(index);
 * try { await work(); if (ref.current !== null) apply(ref.current); }
 * finally { refs.release(ref); }
 * // in the store's removal path:
 * refs.remap(createRemovalIndexMapper(removed));
 * ```
 */

import type { IndexMapper } from './cardIndexRemap';

export interface LiveIndexRef {
  /** The card's current index, or null once it has been removed. */
  current: number | null;
}

export interface LiveIndexRegistry {
  /** Start following the card at `index`. */
  track: (index: number) => LiveIndexRef;
  /** Stop following a ref (its value is left as-is). */
  release: (ref: LiveIndexRef) => void;
  /** Move every tracked ref through `mapIndex` (insertion / removal / reorder). */
  remap: (mapIndex: IndexMapper) => void;
}

export function createLiveIndexRegistry(): LiveIndexRegistry {
  const refs = new Set<LiveIndexRef>();
  return {
    track: (index) => {
      const ref: LiveIndexRef = { current: index };
      refs.add(ref);
      return ref;
    },
    release: (ref) => {
      refs.delete(ref);
    },
    remap: (mapIndex) => {
      refs.forEach((ref) => {
        if (ref.current !== null) ref.current = mapIndex(ref.current);
      });
    },
  };
}
