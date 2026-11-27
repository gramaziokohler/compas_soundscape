/**
 * Pure state transitions shared by every "points over a surface" listener —
 * grid listeners and heatmaps. Each returns a NEW object (stores keep history
 * references), with its points laid out again from the boundary.
 */

import {
  computeAreaBounds,
  computeGridPoints,
  computeGridPointsInArea,
} from '@/lib/three/grid-listener-geometry';
import type { GridListenerData } from '@/types/receiver';
import type { DrawnArea } from '@/types/area-drawing';

type BBox = { min: [number, number, number]; max: [number, number, number] };

/** Points of a surface grid from its boundary (drawn area or bounding box). */
export function layoutSurfacePoints(g: GridListenerData): [number, number, number][] {
  if (g.drawnArea) return computeGridPointsInArea(g.drawnArea, g.xSpacing, g.ySpacing, g.zOffset);
  if (g.boundingBox) return computeGridPoints(g.boundingBox, g.xSpacing, g.ySpacing, g.zOffset);
  return [];
}

/** Apply field updates; spacing / offset changes lay the points out again. */
export function withSurfaceUpdates<T extends GridListenerData>(g: T, updates: Partial<Omit<T, 'id'>>): T {
  const next = { ...g, ...updates };
  const spacingChanged = 'xSpacing' in updates || 'ySpacing' in updates || 'zOffset' in updates;
  if (spacingChanged) next.points = layoutSurfacePoints(next);
  return next;
}

/** Use the bounding box of picked objects as the boundary. */
export function withSurfaceBounds<T extends GridListenerData>(g: T, objectIds: string[], bbox: BBox): T {
  return {
    ...g,
    placementMode: 'objects',
    drawnArea: null,
    selectedObjectIds: objectIds,
    boundingBox: bbox,
    points: computeGridPoints(bbox, g.xSpacing, g.ySpacing, g.zOffset),
  };
}

/** Use a drawn polygon as the boundary (points clipped to it). */
export function withSurfaceArea<T extends GridListenerData>(g: T, area: DrawnArea): T {
  const next: T = {
    ...g,
    placementMode: 'area',
    drawnArea: area,
    selectedObjectIds: [],
    boundingBox: computeAreaBounds(area),
  };
  return { ...next, points: layoutSurfacePoints(next) };
}

/** Move an item of a list (drag reorder). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

/** Deep-clone the item at `from` into `toInsertion` (Ctrl+drag duplicate). */
export function duplicateItemAt<T extends { id: string; name: string }>(
  list: readonly T[],
  from: number,
  toInsertion: number,
  newId: string,
): T[] | null {
  const item = list[from];
  if (!item) return null;
  const cloned: T = { ...structuredClone(item), id: newId, name: `${item.name} (copy)` };
  const next = [...list];
  next.splice(toInsertion > from ? toInsertion - 1 : toInsertion, 0, cloned);
  return next;
}

/** Unique id with a prefix (`grid-listener-…`, `heatmap-listener-…`). */
export function surfaceGridId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
