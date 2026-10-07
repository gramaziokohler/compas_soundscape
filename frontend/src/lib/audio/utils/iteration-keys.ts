/**
 * Helpers for per-iteration maps keyed `${soundId}-${iterationIndex}`
 * (`iterationLinks`, `iterationTrims`). Iteration indices are positions in a
 * track's `soundTimestamps` array, so inserting/removing a clip must shift every
 * key after it — otherwise overrides silently jump to a neighbouring clip.
 */

export function iterationKey(soundId: string, iterationIndex: number): string {
  return `${soundId}-${iterationIndex}`;
}

/**
 * Re-key one track's entries. `mapIdx` returns the new index for an old one,
 * or `null` to drop the entry. Entries of other tracks are kept untouched.
 */
export function remapIterationKeys<T>(
  map: Record<string, T>,
  soundId: string,
  mapIdx: (idx: number) => number | null,
): Record<string, T> {
  const prefix = `${soundId}-`;
  const remapped: Record<string, T> = {};
  Object.entries(map).forEach(([key, value]) => {
    if (!key.startsWith(prefix)) {
      remapped[key] = value;
      return;
    }
    const idx = parseInt(key.slice(prefix.length), 10);
    if (Number.isNaN(idx)) {
      remapped[key] = value;
      return;
    }
    const newIdx = mapIdx(idx);
    if (newIdx !== null) remapped[iterationKey(soundId, newIdx)] = value;
  });
  return remapped;
}

/** Drop every entry belonging to `soundId`. */
export function clearIterationKeysForSound<T>(map: Record<string, T>, soundId: string): Record<string, T> {
  const prefix = `${soundId}-`;
  return Object.fromEntries(Object.entries(map).filter(([k]) => !k.startsWith(prefix)));
}
