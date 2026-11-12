/**
 * Cached geometry-leaf lookups for the Speckle world tree.
 *
 * `getGeometryLeafIdsFromNode` walks a node's whole subtree AND each raw
 * object's property graph, so calling it per tree row on every render cost
 * O(model size) per render (the root row covers the whole model). This module
 * memoizes the result per node id, so each subtree is walked at most once per
 * loaded tree version.
 *
 * Cache key: the tree's root node object + `worldTreeVersion`.
 *   - The viewer builds the tree progressively inside the SAME object while a
 *     model loads (and `handleDuplicates` / `buildRenderTree` mutate it before
 *     `loadObject` resolves). `worldTreeVersion` is bumped only after the load
 *     completes, so a result cached mid-load is dropped by that bump.
 *   - Keying on the root node (not the WorldTree wrapper) keeps the cache valid
 *     across `{ ...tree }` copies made by the Object Explorer's manual refresh.
 *
 * Two namespaces keep results identical to the uncached calls:
 *   - 'row'  — Object Explorer rows (`flattenModelTree` output: geometry-filtered
 *              children, display-mesh rows resolving to their `geometryRoot`).
 *   - 'node' — unfiltered world-tree nodes (`getRootNodesForModel`, walks).
 * Returned arrays / sets are shared: treat them as read-only.
 */
import { getGeometryLeafIdsFromNode, getExplorerNodeId } from '@/hooks/useSpeckleTree';

export type LeafIdNamespace = 'row' | 'node';

interface LeafEntry {
  ids: readonly string[];
  set?: ReadonlySet<string>;
}

interface TreeCache {
  version: number;
  row: Map<string, LeafEntry>;
  node: Map<string, LeafEntry>;
}

const caches = new WeakMap<object, TreeCache>();

/** The tree's root node — stable across shallow copies of the WorldTree wrapper. */
function getTreeRoot(worldTree: unknown): object | null {
  if (!worldTree || typeof worldTree !== 'object') return null;
  const t = worldTree as Record<string, any>;
  const root = t.tree?._root ?? t._root ?? t.root ?? t.tree?.root ?? null;
  return root && typeof root === 'object' ? root : null;
}

function getTreeCache(worldTree: unknown, version: number): TreeCache | null {
  const root = getTreeRoot(worldTree);
  if (!root) return null;
  const existing = caches.get(root);
  if (existing && existing.version === version) return existing;
  const fresh: TreeCache = { version, row: new Map(), node: new Map() };
  caches.set(root, fresh);
  return fresh;
}

/** Cache key for a node: display-mesh rows resolve to their geometry host. */
function nodeKey(node: any): string | null {
  const host = node?.geometryRoot;
  if (host) {
    const hostId = getExplorerNodeId(host);
    return hostId ? `g:${hostId}` : null;
  }
  return getExplorerNodeId(node) ?? null;
}

function getEntry(worldTree: unknown, version: number, node: any, ns: LeafIdNamespace): LeafEntry {
  const cache = getTreeCache(worldTree, version);
  const key = cache ? nodeKey(node) : null;
  if (!cache || !key) return { ids: getGeometryLeafIdsFromNode(node) };
  const map = cache[ns];
  let entry = map.get(key);
  if (!entry) {
    entry = { ids: getGeometryLeafIdsFromNode(node) };
    map.set(key, entry);
  }
  return entry;
}

/** Geometry leaf ids under `node` (cached per tree version). Read-only. */
export function getCachedLeafIds(
  worldTree: unknown,
  version: number,
  node: any,
  ns: LeafIdNamespace = 'row',
): readonly string[] {
  return getEntry(worldTree, version, node, ns).ids;
}

/** Same as {@link getCachedLeafIds}, as a Set for O(1) membership tests. */
export function getCachedLeafIdSet(
  worldTree: unknown,
  version: number,
  node: any,
  ns: LeafIdNamespace = 'row',
): ReadonlySet<string> {
  const entry = getEntry(worldTree, version, node, ns);
  if (!entry.set) entry.set = new Set(entry.ids);
  return entry.set;
}
