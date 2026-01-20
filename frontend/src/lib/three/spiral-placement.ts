import * as THREE from 'three';
import { SPIRAL_PLACEMENT } from '@/lib/constants';
import type { BoundingBoxBounds } from './BoundingBoxManager';

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
  heightOffset: number = 0
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
  positions.push(new THREE.Vector3(centerX, centerY + heightOffset, centerZ));

  // Early return if only one position needed
  if (count === 1) {
    return positions;
  }

  // Generate spiral positions for remaining elements
  let angle = 0;
  let radius = SPIRAL_PLACEMENT.INITIAL_RADIUS;

  for (let i = 1; i < count; i++) {
    // Calculate position in spiral pattern (XZ plane)
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    const y = centerY + heightOffset;

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
