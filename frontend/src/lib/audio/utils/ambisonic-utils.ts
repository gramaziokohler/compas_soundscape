/**
 * Ambisonic Utilities
 *
 * Coordinate, normalization and rotation helpers for ambisonic processing.
 * Encoding is handled by JSAmbisonics monoEncoder, which produces ACN/N3D gains —
 * every encoder MUST go through applySn3dToEncoder() because the rest of the
 * pipeline (OmnitoneDecoder, IR convolution, the multichannel send) is SN3D.
 */

import type { AmbisonicOrder, Orientation, Position3D, SphericalPosition } from '@/types/audio';

/** Number of ACN channels for an ambisonic order: (order + 1)². */
export function ambisonicChannelCount(order: AmbisonicOrder): number {
  return (order + 1) ** 2;
}

/** Minimal shape of a JSAmbisonics monoEncoder (one GainNode per ACN channel). */
export interface AmbisonicGainEncoder {
  gainNodes: GainNode[];
}

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

/**
 * Gain that converts ACN channel `acn` from N3D to SN3D: 1/√(2n+1), n = ⌊√acn⌋.
 */
export function n3dToSn3dGain(acn: number): number {
  const n = Math.floor(Math.sqrt(acn));
  return 1 / Math.sqrt(2 * n + 1);
}

/**
 * Rescale a JSAmbisonics monoEncoder's N3D gains to SN3D in place.
 * Call it right after every `encoder.updateGains()` — updateGains rewrites the
 * gains from scratch, so the conversion must be re-applied each time.
 */
export function applySn3dToEncoder(encoder: AmbisonicGainEncoder): void {
  for (let ch = 1; ch < encoder.gainNodes.length; ch++) {
    encoder.gainNodes[ch].gain.value *= n3dToSn3dGain(ch);
  }
}

/** 3×3 identity in Omnitone's column-major `setRotationMatrix3` layout. */
export const IDENTITY_MATRIX3: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Listener orientation → Omnitone rotation matrix.
 * R = Ry(yaw) · Rx(pitch) · Rz(roll), column-major, Y-up convention.
 * With roll = 0 this reduces to Ry(yaw) · Rx(pitch).
 */
export function orientationToRotationMatrix3(orientation: Orientation): number[] {
  const { yaw, pitch, roll } = orientation;
  const cosYaw = Math.cos(yaw),     sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  const cosRoll = Math.cos(roll),   sinRoll = Math.sin(roll);

  return [
    cosYaw*cosRoll + sinYaw*sinPitch*sinRoll,  cosPitch*sinRoll,  -sinYaw*cosRoll + cosYaw*sinPitch*sinRoll,
    -cosYaw*sinRoll + sinYaw*sinPitch*cosRoll, cosPitch*cosRoll,  sinYaw*sinRoll + cosYaw*sinPitch*cosRoll,
    sinYaw*cosPitch,                           -sinPitch,         cosYaw*cosPitch,
  ];
}

/** Transpose of a 3×3 matrix — the inverse of a rotation matrix. */
export function transposeMatrix3(m: readonly number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
