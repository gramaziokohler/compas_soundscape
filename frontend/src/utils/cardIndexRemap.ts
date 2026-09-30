/**
 * Card index remapping
 *
 * Analysis (context/usage) cards are addressed by their array index, and many
 * links point at them by that index (sound → usage, usage → context, results,
 * active selections, drawn areas, scene runs). Whenever cards are inserted or
 * removed, every link must be passed through an IndexMapper so it keeps
 * following the same card.
 */

/** Maps an old card index to its new index, or `null` when that card was removed. */
export type IndexMapper = (index: number) => number | null;

/** Mapper for inserting one card at `insertAt`: every index at or after it shifts up by one. */
export function createInsertionIndexMapper(insertAt: number): IndexMapper {
  return (index) => (index >= insertAt ? index + 1 : index);
}

/** Mapper for removing `removed` cards: each removed index below a link shifts it down by one. */
export function createRemovalIndexMapper(removed: Iterable<number>): IndexMapper {
  const removedSet = new Set(removed);
  const sorted = [...removedSet].sort((a, b) => a - b);
  return (index) => {
    if (removedSet.has(index)) return null;
    let below = 0;
    while (below < sorted.length && sorted[below] < index) below++;
    return index - below;
  };
}

/** Remap a nullable index; a removed target becomes `null`. */
export function remapNullableIndex(index: number | null, mapIndex: IndexMapper): number | null {
  return index === null ? null : mapIndex(index);
}

/** Remap an optional index; a removed target becomes `undefined`. */
export function remapOptionalIndex(index: number | undefined, mapIndex: IndexMapper): number | undefined {
  return index === undefined ? undefined : (mapIndex(index) ?? undefined);
}

/**
 * Remap a sound config's `parentUsageOriginalIndex`. Non-negative values are usage
 * card indices; negative values use the `-(contextIndex + 1)` namespace of audio
 * context cards that bypass the Usage step. A removed target becomes `undefined`.
 */
export function remapParentUsageIndex(
  pui: number | undefined,
  mapIndex: IndexMapper,
): number | undefined {
  if (pui === undefined) return undefined;
  if (pui >= 0) return remapOptionalIndex(pui, mapIndex);
  const ctxIndex = mapIndex(-pui - 1);
  return ctxIndex === null ? undefined : -(ctxIndex + 1);
}

/** Remap a set of indices, dropping removed ones. */
export function remapIndexSet(indices: ReadonlySet<number>, mapIndex: IndexMapper): Set<number> {
  const next = new Set<number>();
  indices.forEach((i) => {
    const mapped = mapIndex(i);
    if (mapped !== null) next.add(mapped);
  });
  return next;
}

/** Remap the keys of an index-keyed Map, dropping removed keys. `mapValue` rewrites surviving values. */
export function remapIndexKeyedMap<V>(
  map: ReadonlyMap<number, V>,
  mapIndex: IndexMapper,
  mapValue: (value: V, newIndex: number) => V = (v) => v,
): Map<number, V> {
  const next = new Map<number, V>();
  map.forEach((value, key) => {
    const mapped = mapIndex(key);
    if (mapped !== null) next.set(mapped, mapValue(value, mapped));
  });
  return next;
}

/** Remap the keys of an index-keyed Record, dropping removed keys. `mapValue` rewrites surviving values. */
export function remapIndexKeyedRecord<V>(
  record: Readonly<Record<number, V>>,
  mapIndex: IndexMapper,
  mapValue: (value: V, newIndex: number) => V = (v) => v,
): Record<number, V> {
  const next: Record<number, V> = {};
  Object.entries(record).forEach(([key, value]) => {
    const mapped = mapIndex(Number(key));
    if (mapped !== null) next[mapped] = mapValue(value, mapped);
  });
  return next;
}
