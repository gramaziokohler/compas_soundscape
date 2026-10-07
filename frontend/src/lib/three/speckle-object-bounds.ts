/**
 * Union bounding box of a set of Speckle viewer objects.
 *
 * Resolves each id through the RenderTree (`getRenderViewsForNodeId`) and unions the
 * render views' world-space AABBs — the same pattern as useSpeckleSoundSpheres. Works for
 * leaf geometry ids and for parent/layer nodes (their render views are the descendants').
 */

import * as THREE from 'three';
import type { Viewer } from '@speckle/viewer';

export interface ObjectBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * @param viewer    Live Speckle viewer.
 * @param objectIds Viewer node ids (e.g. the acoustic-region geometry leaf ids).
 * @returns The union box, or null when no id resolves to renderable geometry.
 */
export function computeSpeckleObjectsBounds(
  viewer: Viewer | null | undefined,
  objectIds: string[],
): ObjectBounds | null {
  if (!viewer || objectIds.length === 0) return null;

  const box = new THREE.Box3();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RenderTree typings are not exported
    const renderTree: any = (viewer.getWorldTree?.() as any)?.getRenderTree?.();
    if (!renderTree?.getRenderViewsForNodeId) return null;

    for (const id of objectIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rvs: any[] = renderTree.getRenderViewsForNodeId(id) ?? [];
      for (const rv of rvs) {
        const aabb: THREE.Box3 | undefined = rv.aabb ?? rv.computeAABB?.();
        if (aabb && !aabb.isEmpty()) box.union(aabb);
      }
    }
  } catch (err) {
    console.warn('[speckle-object-bounds] Could not compute object bounds:', err);
    return null;
  }

  if (box.isEmpty()) return null;
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}
