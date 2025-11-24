/**
 * Ambisonic Utilities
 *
 * Coordinate conversion utilities for ambisonic audio processing.
 * Encoding is now handled by JSAmbisonics library (monoEncoder class).
 */

import type { Position3D, SphericalPosition } from '@/types/audio';

/**
 * Convert Cartesian (x, y, z) coordinates to spherical (azimuth, elevation, distance)
 *
 * Coordinate system:
 * - X: Front (positive) / Back (negative)
 * - Y: Left (positive) / Right (negative)
 * - Z: Up (positive) / Down (negative)
 *
 * @param position - 3D Cartesian position
 * @returns Spherical coordinates (azimuth and elevation in radians)
 */
export function cartesianToSpherical(position: Position3D): SphericalPosition {
  const { x, y, z } = position;

  const distance = Math.sqrt(x * x + y * y + z * z);

  // Avoid division by zero
  if (distance < 0.0001) {
    return { azimuth: 0, elevation: 0, distance: 0 };
  }

  // Azimuth: angle in horizontal plane
  // atan2(y, x): 0 = front, π/2 = left, π = back, -π/2 = right
  const azimuth = Math.atan2(y, x);

  // Elevation: angle from horizontal plane
  // asin(z / distance): π/2 = up, -π/2 = down, 0 = horizontal
  const elevation = Math.asin(Math.max(-1, Math.min(1, z / distance)));

  return { azimuth, elevation, distance };
}
