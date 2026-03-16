/**
 * Sound Positioning Utilities
 *
 * Helper functions for calculating sound positions in 3D space.
 * Extracted from useSoundGeneration.ts to reduce duplication.
 */

import * as THREE from 'three';
import type { SoundGenerationConfig } from "@/types";
import type { DrawnArea } from "@/types/area-drawing";
import {
  DEFAULT_POSITION_SPACING,
  DEFAULT_POSITION_OFFSET,
  DEFAULT_POSITION_Y,
  DEFAULT_POSITION_Z,
  AREA_DRAWING
} from "@/utils/constants";
import {
  randomPointInPolygon2D,
  unprojectPoint2DTo3D,
  chooseProjectionAxes,
  computePolygonBounds,
} from "@/lib/three/polygon-utils";

/**
 * Geometry bounding box
 */
export interface GeometryBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Calculate sound position from config and geometry bounds.
 *
 * Priority order:
 * 1. Entity position (if provided)
 * 2. Geometry bounding box center (if available)
 * 3. Origin [0, 0, 0] (fallback)
 *
 * @param config - Sound generation configuration
 * @param geometryBounds - Optional bounding box of the 3D model
 * @returns 3D position [x, y, z]
 */
export function calculateSoundPosition(
  config: SoundGenerationConfig,
  geometryBounds?: GeometryBounds
): [number, number, number] {
  // Priority 1: Use entity position if available
  if (config.entity?.position) {
    return config.entity.position;
  }

  // Priority 2: Use geometry center if bounds available
  if (geometryBounds) {
    return calculateGeometryCenter(geometryBounds);
  }

  // Priority 3: Default to origin
  return [0, 0, 0];
}

/**
 * Calculate the center point of a bounding box.
 *
 * @param bounds - Geometry bounding box with min/max points
 * @returns Center position [x, y, z]
 */
export function calculateGeometryCenter(
  bounds: GeometryBounds
): [number, number, number] {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

/**
 * Calculate distance between two 3D points.
 *
 * @param pos1 - First position [x, y, z]
 * @param pos2 - Second position [x, y, z]
 * @returns Euclidean distance
 */
export function calculateDistance(
  pos1: [number, number, number],
  pos2: [number, number, number]
): number {
  const dx = pos2[0] - pos1[0];
  const dy = pos2[1] - pos1[1];
  const dz = pos2[2] - pos1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate sound position with proper spacing for multiple sounds.
 * This matches the backend's get_random_position logic.
 *
 * Priority order:
 * 1. Entity position (if provided in config)
 * 2. Random position within bounding box (if available and no entity)
 * 3. Linear spacing along X-axis (default fallback)
 *
 * @param config - Sound generation configuration
 * @param soundIndex - Index of this sound in the complete list (0-based)
 * @param totalSounds - Total number of sounds being generated (all modes combined)
 * @param geometryBounds - Optional bounding box of the 3D model
 * @returns 3D position [x, y, z]
 */
export function calculateSoundPositionWithSpacing(
  config: SoundGenerationConfig,
  soundIndex: number,
  totalSounds: number,
  geometryBounds?: GeometryBounds
): [number, number, number] {
  // Priority 1: Use entity position if available
  if (config.entity?.position) {
    return config.entity.position;
  }

  // Priority 2: Random position within bounding box
  if (geometryBounds) {
    return [
      Math.random() * (geometryBounds.max[0] - geometryBounds.min[0]) + geometryBounds.min[0],
      Math.random() * (geometryBounds.max[1] - geometryBounds.min[1]) + geometryBounds.min[1],
      Math.random() * (geometryBounds.max[2] - geometryBounds.min[2]) + geometryBounds.min[2]
    ];
  }

  // Priority 3: Linear spacing along X-axis (default)
  return [
    (soundIndex * DEFAULT_POSITION_SPACING) - (totalSounds * DEFAULT_POSITION_OFFSET),
    DEFAULT_POSITION_Y,
    DEFAULT_POSITION_Z
  ];
}

/**
 * Generate random 3D positions within a drawn polygon area.
 *
 * Uses rejection sampling in the 2D projected polygon, then unprojects
 * back to 3D at planeOrigin.z + hearingHeight (Z-up convention).
 *
 * @param area - Drawn polygon area with projected 2D vertices
 * @param count - Number of positions to generate
 * @param hearingHeight - Height above the polygon plane (default 1.5m)
 * @returns Array of [x, y, z] positions
 */
export function generatePositionsInArea(
  area: DrawnArea,
  count: number,
  hearingHeight: number = AREA_DRAWING.HEARING_HEIGHT
): [number, number, number][] {
  const polygon2D = area.projectedVertices;
  if (polygon2D.length < 3) return [];

  const planeOrigin = new THREE.Vector3(...area.planeOrigin);
  const planeNormal = new THREE.Vector3(...area.planeNormal);
  const axes = chooseProjectionAxes(planeNormal);
  const bounds = computePolygonBounds(polygon2D);

  const positions: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const pt2D = randomPointInPolygon2D(polygon2D, bounds);
    const pt3D = unprojectPoint2DTo3D(pt2D, planeOrigin, planeNormal, axes);

    // Apply hearing height along Z (Z-up convention)
    positions.push([pt3D.x, pt3D.y, pt3D.z + hearingHeight]);
  }

  return positions;
}
