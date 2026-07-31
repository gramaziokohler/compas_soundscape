declare module 'spherical-harmonic-transform' {
  /** Convert yaw/pitch/roll Euler angles to a 3×3 rotation matrix (ZYX convention). */
  export function yawPitchRoll2Rzyx(yaw: number, pitch: number, roll: number): number[][];

  /**
   * Compute the block-diagonal Wigner D-matrix for rotating ambisonic signals.
   * Returns an (order+1)² × (order+1)² matrix (block-diagonal per order band).
   */
  export function getSHrotMtx(R: number[][], order: number): number[][];
}
