/**
 * Polygon Math Utilities
 *
 * Pure math functions for polygon projection, point-in-polygon testing,
 * random sampling, and triangulation. Used by AreaDrawingManager and
 * position generation for the area drawing feature.
 *
 * Coordinate system: Z-up (Speckle convention).
 */

import * as THREE from 'three';
// @ts-expect-error — earcut lacks type declarations; used as transitive dependency via Three.js
import earcut from 'earcut';

/**
 * Project a 3D point onto a plane defined by origin and normal.
 */
export function projectOnPlane(
  point: THREE.Vector3,
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3
): THREE.Vector3 {
  const diff = new THREE.Vector3().subVectors(point, planeOrigin);
  const dist = diff.dot(planeNormal);
  return new THREE.Vector3().copy(point).addScaledVector(planeNormal, -dist);
}

/**
 * Choose two orthogonal axes for 2D projection from a plane normal.
 * Returns [axisU, axisV] such that U × V ≈ normal direction.
 */
export function chooseProjectionAxes(
  normal: THREE.Vector3
): [THREE.Vector3, THREE.Vector3] {
  const absX = Math.abs(normal.x);
  const absY = Math.abs(normal.y);
  const absZ = Math.abs(normal.z);

  // Pick the axis least aligned with normal as seed
  let seed: THREE.Vector3;
  if (absX <= absY && absX <= absZ) {
    seed = new THREE.Vector3(1, 0, 0);
  } else if (absY <= absX && absY <= absZ) {
    seed = new THREE.Vector3(0, 1, 0);
  } else {
    seed = new THREE.Vector3(0, 0, 1);
  }

  const axisU = new THREE.Vector3().crossVectors(normal, seed).normalize();
  const axisV = new THREE.Vector3().crossVectors(normal, axisU).normalize();

  return [axisU, axisV];
}

/**
 * Project an array of 3D polygon vertices into 2D using a plane.
 */
export function projectPolygonTo2D(
  vertices: THREE.Vector3[],
  planeNormal: THREE.Vector3,
  planeOrigin: THREE.Vector3
): [number, number][] {
  const [axisU, axisV] = chooseProjectionAxes(planeNormal);

  return vertices.map((v) => {
    const diff = new THREE.Vector3().subVectors(v, planeOrigin);
    return [diff.dot(axisU), diff.dot(axisV)] as [number, number];
  });
}

/**
 * Unproject a 2D point back to 3D on the drawing plane.
 */
export function unprojectPoint2DTo3D(
  point2D: [number, number],
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
  axes?: [THREE.Vector3, THREE.Vector3]
): THREE.Vector3 {
  const [axisU, axisV] = axes ?? chooseProjectionAxes(planeNormal);
  return new THREE.Vector3()
    .copy(planeOrigin)
    .addScaledVector(axisU, point2D[0])
    .addScaledVector(axisV, point2D[1]);
}

/**
 * Compute the signed area of a 2D polygon using the shoelace formula.
 */
export function shoelaceArea2D(points: [number, number][]): number {
  const n = points.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Test if a 2D point is inside a polygon using ray-casting algorithm.
 */
export function isPointInPolygon2D(
  point: [number, number],
  polygon: [number, number][]
): boolean {
  const [px, py] = point;
  const n = polygon.length;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Generate a random point inside a 2D polygon using rejection sampling.
 */
export function randomPointInPolygon2D(
  polygon: [number, number][],
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
): [number, number] {
  // Compute bounds if not provided
  const b = bounds ?? computePolygonBounds(polygon);
  const maxAttempts = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = b.minX + Math.random() * (b.maxX - b.minX);
    const y = b.minY + Math.random() * (b.maxY - b.minY);
    if (isPointInPolygon2D([x, y], polygon)) {
      return [x, y];
    }
  }

  // Fallback: return centroid
  const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
  const cy = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
  return [cx, cy];
}

/**
 * Compute bounding box of a 2D polygon.
 */
export function computePolygonBounds(
  polygon: [number, number][]
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Triangulate a 2D polygon using earcut.
 * Returns an array of triangle vertex indices.
 */
export function triangulatePolygon2D(points: [number, number][]): number[] {
  const flat = points.flatMap(([x, y]) => [x, y]);
  return earcut(flat);
}

/**
 * Test if a 3D point falls inside a vertically extruded polygon.
 * The polygon is defined on a plane; the extrusion is along the plane normal.
 *
 * For Z-up scenes: the polygon lies on the surface, and we extrude
 * ±extrudeDistance along Z (or the plane normal) to capture objects
 * above/below the surface.
 */
export function isPointInsideExtrudedPolygon(
  point3D: THREE.Vector3,
  polygon2D: [number, number][],
  planeOrigin: THREE.Vector3,
  planeNormal: THREE.Vector3,
  extrudeDistance: number
): boolean {
  // Check distance from plane
  const diff = new THREE.Vector3().subVectors(point3D, planeOrigin);
  const distFromPlane = diff.dot(planeNormal);

  if (Math.abs(distFromPlane) > extrudeDistance) {
    return false;
  }

  // Project point onto 2D plane and test containment
  const [axisU, axisV] = chooseProjectionAxes(planeNormal);
  const projectedPoint: [number, number] = [diff.dot(axisU), diff.dot(axisV)];

  return isPointInPolygon2D(projectedPoint, polygon2D);
}
