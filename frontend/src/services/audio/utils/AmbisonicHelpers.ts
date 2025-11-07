/**
 * Ambisonic Helpers
 *
 * Utility functions for ambisonic audio processing.
 * Converts between coordinate systems and calculates encoding coefficients.
 */

export interface SphericalPosition {
  azimuth: number;   // Radians, 0 = front, π/2 = left
  elevation: number; // Radians, π/2 = up, -π/2 = down
  distance: number;  // Meters
}

export class AmbisonicHelpers {
  /**
   * Convert Cartesian (x, y, z) to Spherical (azimuth, elevation, distance)
   */
  static cartesianToSpherical(
    position: [number, number, number],
    listenerPosition: [number, number, number] = [0, 0, 0]
  ): SphericalPosition {
    // Relative position
    const x = position[0] - listenerPosition[0];
    const y = position[1] - listenerPosition[1];
    const z = position[2] - listenerPosition[2];

    // Distance
    const distance = Math.sqrt(x * x + y * y + z * z);

    // Azimuth (horizontal angle)
    // 0 = front (+Z), π/2 = left (+X), π = back (-Z), -π/2 = right (-X)
    const azimuth = Math.atan2(x, -z);

    // Elevation (vertical angle)
    // π/2 = up (+Y), 0 = horizontal, -π/2 = down (-Y)
    const elevation = Math.asin(y / (distance || 1));

    return { azimuth, elevation, distance };
  }

  /**
   * Calculate First-Order Ambisonics (FOA) encoding coefficients
   * Returns [W, X, Y, Z] coefficients
   */
  static calculateFOACoefficients(spherical: SphericalPosition): [number, number, number, number] {
    const { azimuth, elevation } = spherical;

    const cosEl = Math.cos(elevation);

    // ACN ordering (W, Y, Z, X)
    const W = 1 / Math.sqrt(2); // Omnidirectional (0th order)
    const Y = cosEl * Math.sin(azimuth); // Left-Right
    const Z = cosEl * Math.cos(azimuth); // Front-Back
    const X = Math.sin(elevation); // Up-Down

    return [W, X, Y, Z];
  }

  /**
   * Apply rotation to FOA coefficients
   * Uses Euler angles (yaw, pitch, roll) in radians
   */
  static rotateFOA(
    coeffs: [number, number, number, number],
    orientation: [number, number, number]
  ): [number, number, number, number] {
    const [W, X, Y, Z] = coeffs;
    const [yaw, pitch, roll] = orientation;

    // Simplified rotation (yaw only for now)
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    const W_rot = W;
    const X_rot = X;
    const Y_rot = Y * cosYaw - Z * sinYaw;
    const Z_rot = Y * sinYaw + Z * cosYaw;

    return [W_rot, X_rot, Y_rot, Z_rot];
  }

  /**
   * Distance attenuation
   */
  static calculateDistanceAttenuation(
    distance: number,
    refDistance: number = 1,
    rolloffFactor: number = 1
  ): number {
    if (distance <= 0) return 1;
    return refDistance / (refDistance + rolloffFactor * (distance - refDistance));
  }
}
