/**
 * Grid Listener Geometry
 *
 * Pure functions that lay out grid-listener points, either over the bounding
 * box of picked surfaces or inside a polygon drawn on the model.
 */

import * as THREE from 'three';
import {
  chooseProjectionAxes,
  isPointInPolygon2D,
  unprojectPoint2DTo3D,
} from '@/lib/three/polygon-utils';
import type { DrawnArea } from '@/types/area-drawing';

type Vec3 = [number, number, number];
export type GridBounds = { min: Vec3; max: Vec3 };

/**
 * The surface-normal axis of a box: the axis with the smallest range (the
 * "thin" slab direction), regardless of whether the model is Y-up or Z-up.
 */
function detectNormalAxis(bbox: GridBounds): 0 | 1 | 2 {
  const ranges = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
  let normalAxis: 0 | 1 | 2 = 0;
  if (ranges[1] < ranges[normalAxis]) normalAxis = 1;
  if (ranges[2] < ranges[normalAxis]) normalAxis = 2;
  return normalAxis;
}

/**
 * Compute a centered 2D grid of listener points from a bounding box.
 *
 * The grid is placed on the two larger axes, and zOffset moves points along
 * the normal axis (see detectNormalAxis).
 */
export function computeGridPoints(
  bbox: GridBounds,
  xSpacing: number,
  ySpacing: number,
  zOffset: number,
): Vec3[] {
  const normalAxis = detectNormalAxis(bbox);

  // The two grid axes are the other two
  const gridAxes = ([0, 1, 2] as const).filter((a) => a !== normalAxis) as [0 | 1 | 2, 0 | 1 | 2];
  const axis1 = gridAxes[0]; // maps to xSpacing
  const axis2 = gridAxes[1]; // maps to ySpacing

  // Normal position = mid of slab + zOffset (elevates the grid above the surface)
  const normalMid = (bbox.min[normalAxis] + bbox.max[normalAxis]) / 2 + zOffset;

  const range1 = bbox.max[axis1] - bbox.min[axis1];
  const range2 = bbox.max[axis2] - bbox.min[axis2];
  const center1 = (bbox.min[axis1] + bbox.max[axis1]) / 2;
  const center2 = (bbox.min[axis2] + bbox.max[axis2]) / 2;

  const count1 = Math.max(1, Math.floor(range1 / xSpacing) + 1);
  const count2 = Math.max(1, Math.floor(range2 / ySpacing) + 1);
  const start1 = center1 - ((count1 - 1) / 2) * xSpacing;
  const start2 = center2 - ((count2 - 1) / 2) * ySpacing;

  const points: Vec3[] = [];
  for (let i1 = 0; i1 < count1; i1++) {
    for (let i2 = 0; i2 < count2; i2++) {
      const pt: Vec3 = [0, 0, 0];
      pt[normalAxis] = normalMid;
      pt[axis1] = start1 + i1 * xSpacing;
      pt[axis2] = start2 + i2 * ySpacing;
      points.push(pt);
    }
  }
  return points;
}

/** The drawn polygon's vertices in 3D, on its drawing plane. */
function areaVertices3D(area: DrawnArea): THREE.Vector3[] {
  const origin = new THREE.Vector3(...area.planeOrigin);
  const normal = new THREE.Vector3(...area.planeNormal);
  const axes = chooseProjectionAxes(normal);
  return area.projectedVertices.map((p) => unprojectPoint2DTo3D(p, origin, normal, axes));
}

/** Axis-aligned 3D bounding box of a drawn polygon. */
export function computeAreaBounds(area: DrawnArea): GridBounds {
  const box = new THREE.Box3().setFromPoints(areaVertices3D(area));
  return { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
}

/**
 * Grid points clipped to a drawn polygon: the bounding-box grid of the polygon,
 * keeping only points whose projection on the drawing plane falls inside it.
 * When the polygon is smaller than one grid cell (nothing survives), a single
 * point is placed at its centroid so the grid never silently ends up empty.
 */
export function computeGridPointsInArea(
  area: DrawnArea,
  xSpacing: number,
  ySpacing: number,
  zOffset: number,
): Vec3[] {
  if (area.projectedVertices.length < 3) return [];

  const bbox = computeAreaBounds(area);
  const origin = new THREE.Vector3(...area.planeOrigin);
  const [axisU, axisV] = chooseProjectionAxes(new THREE.Vector3(...area.planeNormal));
  const diff = new THREE.Vector3();

  const inside = computeGridPoints(bbox, xSpacing, ySpacing, zOffset).filter((pt) => {
    diff.set(pt[0], pt[1], pt[2]).sub(origin);
    return isPointInPolygon2D([diff.dot(axisU), diff.dot(axisV)], area.projectedVertices);
  });
  if (inside.length > 0) return inside;

  const centroid = new THREE.Vector3();
  const verts = areaVertices3D(area);
  for (const v of verts) centroid.add(v);
  centroid.divideScalar(verts.length);
  const point = centroid.toArray() as Vec3;
  point[detectNormalAxis(bbox)] += zOffset;
  return [point];
}
