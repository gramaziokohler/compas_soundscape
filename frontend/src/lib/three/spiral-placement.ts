import * as THREE from 'three';
import { SPIRAL_PLACEMENT, EAR_HEIGHT } from '@/utils/constants';
import type { BoundingBoxBounds } from './BoundingBoxManager';

// ============================================================================
// Camera-Based Spiral Placement
// ============================================================================

/**
 * Generate spiral positions centered on a given point (plain-array version).
 * Spreads in the XY horizontal plane, keeping Z fixed at center.z.
 *
 * @param center - [x, y, z] center point (e.g. camera-front position)
 * @param count  - Total number of positions to generate
 * @returns Array of [x, y, z] positions in spiral pattern around center
 */
function generateSpiralPositionsFromCenter(
  center: [number, number, number],
  count: number
): [number, number, number][] {
  if (count === 0) return [];

  const positions: [number, number, number][] = [];
  positions.push([center[0], center[1], center[2]]);

  let angle = 0;
  let radius = SPIRAL_PLACEMENT.INITIAL_RADIUS;

  for (let i = 1; i < count; i++) {
    positions.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
      center[2],
    ]);
    angle += SPIRAL_PLACEMENT.ANGLE_INCREMENT;
    radius += SPIRAL_PLACEMENT.RADIUS_INCREMENT / (2 * Math.PI / SPIRAL_PLACEMENT.ANGLE_INCREMENT);
  }

  return positions;
}

/**
 * Get the spiral position for a single index around a center point.
 * Does NOT require THREE.js — safe to import in React components.
 *
 * @param center - [x, y, z] camera-front (or any anchor) position
 * @param index  - 0-based index in the spiral (0 = center, 1+ = outward)
 * @returns [x, y, z] position for this slot in the spiral
 */
export function getCameraFrontSpiralPosition(
  center: [number, number, number],
  index: number
): [number, number, number] {
  return generateSpiralPositionsFromCenter(center, index + 1)[index] ?? [center[0], center[1], center[2]];
}

/**
 * Calculate multiple camera-front spiral positions (THREE.Vector3 version).
 * Used internally by SoundSphereManager.
 *
 * @param center - THREE.Vector3 camera-front position
 * @param count  - Number of positions to generate
 * @returns Array of THREE.Vector3 positions in spiral pattern
 */
export function calculateCameraFrontSpiralPositions(
  center: THREE.Vector3,
  count: number
): THREE.Vector3[] {
  return generateSpiralPositionsFromCenter([center.x, center.y, center.z], count)
    .map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

/**
 * Spiral Placement Utility
 * 
 * Provides spiral pattern placement for sound spheres and receivers
 * within a bounding box.
 * 
 * Algorithm:
 * 1. First element placed at bounding box center
 * 2. Subsequent elements placed in spiral pattern around center
 * 3. Spiral grows outward using angle and radius increments
 */

/**
 * Calculate spiral positions within bounding box
 * 
 * @param bounds - Bounding box bounds (min/max coordinates)
 * @param count - Number of positions to generate
 * @param heightOffset - Optional Y-axis offset from center (default: 0)
 * @returns Array of Vector3 positions in spiral pattern
 */
export function calculateSpiralPositions(
  bounds: BoundingBoxBounds,
  count: number,
): THREE.Vector3[] {
  if (count === 0) {
    return [];
  }

  // Calculate bounding box center
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const positions: THREE.Vector3[] = [];

  // First element at center (with optional height offset)
  positions.push(new THREE.Vector3(centerX, centerY , minZ + EAR_HEIGHT));

  // Early return if only one position needed
  if (count === 1) {
    return positions;
  }

  // Generate spiral positions for remaining elements
  let angle = 0;
  let radius = SPIRAL_PLACEMENT.INITIAL_RADIUS;

  for (let i = 1; i < count; i++) {
    // Calculate position in spiral pattern (XY plane)
    const x = centerX + Math.cos(angle) * radius;
    const z = minZ + EAR_HEIGHT; // Keep Z constant at ear height + offset
    const y = centerY + Math.sin(angle) * radius;

    positions.push(new THREE.Vector3(x, y, z));

    // Increment angle and radius for next position
    angle += SPIRAL_PLACEMENT.ANGLE_INCREMENT;
    
    // Gradually expand radius as spiral grows
    // This creates a smooth spiral pattern
    radius += SPIRAL_PLACEMENT.RADIUS_INCREMENT / (2 * Math.PI / SPIRAL_PLACEMENT.ANGLE_INCREMENT);
  }

  return positions;
}

/**
 * Check if positions should use spiral placement
 * 
 * This is used when:
 * 1. A bounding box is available
 * 2. Positions need to be auto-generated (not from existing geometry)
 * 
 * @param bounds - Bounding box bounds (null if not available)
 * @param hasExistingPositions - Whether items already have explicit positions
 * @returns True if spiral placement should be used
 */
export function shouldUseSpiralPlacement(
  bounds: BoundingBoxBounds | null,
  hasExistingPositions: boolean
): boolean {
  return bounds !== null && !hasExistingPositions;
}
