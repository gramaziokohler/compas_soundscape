/**
 * Ambisonic Utilities
 *
 * Coordinate and rotation helpers for ambisonic processing. Encoding is done
 * by AmbisonicMonoEncoder (ambisonic-encoder.ts), which writes ACN/SN3D gains —
 * the normalization of every bus in the pipeline (OmnitoneDecoder, IR
 * convolution, the multichannel send).
 */

import type { AmbisonicOrder, Orientation, Position3D, SphericalPosition } from '@/types/audio';

/** Number of ACN channels for an ambisonic order: (order + 1)². */
export function ambisonicChannelCount(order: AmbisonicOrder): number {
  return (order + 1) ** 2;
}

/** Minimal shape of an ambisonic gain encoder (one GainNode per ACN channel). */
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

/** 3×3 identity in Omnitone's column-major `setRotationMatrix3` layout. */
export const IDENTITY_MATRIX3: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

type Matrix3 = number[][]; // row-major

function rotX(a: number): Matrix3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

function rotY(a: number): Matrix3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function rotZ(a: number): Matrix3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function multiplyRowMajor(a: Matrix3, b: Matrix3): Matrix3 {
  return a.map((row) => [0, 1, 2].map((col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col]));
}

/**
 * Listener orientation → Omnitone rotation matrix (column-major `setRotationMatrix3`).
 *
 * Omnitone rotates the sound field by the matrix it is given, in a Y-up frame
 * (x = right, y = up, z = back), so head tracking needs the WORLD→HEAD rotation:
 * the inverse of the head's orientation (its `setRotationMatrixFromCamera` inverts the
 * camera matrix for the same reason).
 *
 * The listener convention (speckle-camera-controller.ts): +yaw turns RIGHT (toward world
 * −X), +pitch looks up, +roll tilts the head left (about the camera's +Z). In Omnitone's
 * frame the head is H = Ry(−yaw) · Rx(pitch) · Rz(roll), so the field rotation is
 * Hᵀ = Rz(−roll) · Rx(−pitch) · Ry(yaw): the pitch and roll axes follow the head after a
 * yaw, and looking up moves a frontal source down.
 */
export function orientationToRotationMatrix3(orientation: Orientation): number[] {
  const { yaw, pitch, roll } = orientation;
  const m = multiplyRowMajor(multiplyRowMajor(rotZ(-roll), rotX(-pitch)), rotY(yaw));
  // column-major: m[row][col] → index col * 3 + row
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
}

/**
 * Rotation matrix for Omnitone's `HOARotator` (inside `HOARenderer` for orders 2–3, and the
 * multichannel send), so it rotates exactly like `FOARotator` does with `m`.
 *
 * `HOARotator.setRotationMatrix3` negates columns 0 and 2 of what `FOARotator` reads: given
 * the identity it turns the field 180° about the vertical (left↔right, front↔back), while the
 * HOA HRIR convolver after it expects plain ACN. Measured through the real renderers: an
 * order-3 source on the left came out 10 dB louder in the RIGHT ear. Feeding
 * m · diag(−1, 1, −1) cancels the flip.
 */
export function toHoaRotatorMatrix3(m: readonly number[]): number[] {
  return [-m[0], -m[1], -m[2], m[3], m[4], m[5], -m[6], -m[7], -m[8]];
}

/** Transpose of a 3×3 matrix — the inverse of a rotation matrix. */
export function transposeMatrix3(m: readonly number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
