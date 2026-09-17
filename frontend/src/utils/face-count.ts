/**
 * Mesh-face counting for the live Speckle viewer.
 *
 * The raw Speckle objects fetched by the viewer have their `faces` / `vertices`
 * arrays EMPTIED during the async tree build (`disposeNodeGeometryData` in
 * `@speckle/viewer` sets `model.raw.faces = []`), so face counts cannot be read
 * from the object graph after load.
 *
 * The render geometry that survives is the per-BatchObject BVH
 * (`batchObject.accelerationStructure.geometry`) — the same mesh used for
 * raycasting. Its triangle count is `index.count / 3` (fallback: position
 * count / 3). This mirrors the verified pattern in `.cursor/rules/speckle.mdc`.
 */

/**
 * Compute mesh-face (triangle) counts for the given geometry object ids.
 *
 * @param viewer       Live Speckle `Viewer` instance.
 * @param geometryIds  Assignable geometry leaf ids (from `getGeometryLeafIdsFromNode`).
 * @returns            Map of object id → triangle count (0 when unknown/not yet built).
 */
export function computeGeometryFaceCounts(
  viewer: unknown,
  geometryIds: string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!viewer || geometryIds.length === 0) return counts;

  try {
    const v = viewer as {
      getWorldTree?: () => { getRenderTree?: () => { getRenderViewsForNodeId?: (id: string) => unknown[] | null } } | null;
      getRenderer?: () => {
        getObject?: (rv: unknown) => {
          accelerationStructure?: { geometry?: {
            getIndex?: () => { count?: number } | null;
            getAttribute?: (name: string) => { count?: number } | undefined;
          } } | null;
        } | null;
      } | null;
    };

    const renderTree = v.getWorldTree?.()?.getRenderTree?.();
    const renderer = v.getRenderer?.();
    if (!renderTree || !renderer) return counts;

    for (const id of geometryIds) {
      let tris = 0;
      const renderViews = renderTree.getRenderViewsForNodeId?.(id) ?? [];
      for (const rv of renderViews) {
        const batchObject = renderer.getObject?.(rv);
        const geo = batchObject?.accelerationStructure?.geometry;
        if (!geo) continue;
        const index = geo.getIndex?.();
        if (index && typeof index.count === 'number') {
          tris += Math.floor(index.count / 3);
        } else {
          const pos = geo.getAttribute?.('position');
          if (pos && typeof pos.count === 'number') tris += Math.floor(pos.count / 3);
        }
      }
      counts.set(id, tris);
    }
  } catch (err) {
    console.warn('[dbg:faces] computeGeometryFaceCounts failed:', err);
  }

  return counts;
}
