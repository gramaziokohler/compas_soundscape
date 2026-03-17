/**
 * Ambisonic Utilities
 *
 * Coordinate conversion and normalization utilities for ambisonic audio processing.
 * Encoding is now handled by JSAmbisonics library (monoEncoder class).
 */

import type { Position3D, SphericalPosition } from '@/types/audio';

/**
 * Convert an AudioBuffer from SN3D normalization (AmbiX) to N3D normalization (JSAmbisonics).
 *
 * SN3D and N3D differ by a per-order scale factor: N3D = SN3D * sqrt(2*l + 1)
 *   - Order 0 (W): factor = 1 (unchanged)
 *   - Order 1 (Y, Z, X): factor = sqrt(3) ≈ 1.732
 *   - Order 2: factor = sqrt(5) ≈ 2.236
 *   - Order 3: factor = sqrt(7) ≈ 2.646
 *
 * ACN channel-to-order mapping: order = floor(sqrt(channel))
 *
 * @param buffer - AudioBuffer in SN3D normalization
 * @param audioContext - AudioContext for creating output buffer
 * @returns New AudioBuffer in N3D normalization
 */
export function convertSN3DtoN3D(buffer: AudioBuffer, audioContext: AudioContext): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const newBuffer = audioContext.createBuffer(numChannels, buffer.length, buffer.sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const order = Math.floor(Math.sqrt(ch)); // ACN → ambisonic order
    const scale = Math.sqrt(2 * order + 1);  // SN3D → N3D factor
    const input = buffer.getChannelData(ch);
    const output = newBuffer.getChannelData(ch);

    if (scale === 1.0) {
      // Order 0: just copy
      output.set(input);
    } else {
      for (let i = 0; i < input.length; i++) {
        output[i] = input[i] * scale;
      }
    }
  }

  return newBuffer;
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
