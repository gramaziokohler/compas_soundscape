/**
 * Ray-count estimate for the pyroomacoustics hybrid (ISM + ray tracing) simulator.
 *
 * Both values are derived from the model bounding box (metres):
 *   V = x·y·z,  S = 2(xy + yz + zx),  MFP = 4V/S  (mean free path)
 *
 * - minimum: Rindel (1995) eq. (1), N ≥ 8π c² t² / A, evaluated over the early window
 *   covered by the Image-Source order m, t = m·MFP / c  (c cancels → 8π (m·MFP)² / A).
 * - recommended: the larger of the minimum and the late-tail receiver density
 *   K·V / (π r² c Δt), i.e. K expected ray hits per histogram bin on the receiver sphere.
 *
 * Both are clamped to the slider range.
 */

import {
  DEFAULT_SPEED_OF_SOUND,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN,
  PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX,
  PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
  PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE,
  PYROOMACOUSTICS_RAY_TRACING_TARGET_HITS_PER_BIN,
  PYROOMACOUSTICS_RAY_TRACING_MIN_RESOLVED_SURFACE_AREA,
} from '@/utils/constants';

export interface RayCountBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface RayCountEstimate {
  /** Minimum rays (Rindel eq. 1 over the ISM window), clamped to the slider range. */
  min: number;
  /** Recommended rays (max of min and the late-tail density), clamped to the slider range. */
  recommended: number;
  /** Bounding-box volume in m³. */
  volume: number;
}

const clampRays = (n: number): number =>
  Math.min(PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX, Math.max(PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN, n));

/** Round to the nearest `step` so the marker lands on a slider step. */
const roundToStep = (n: number, step: number): number => Math.round(n / step) * step;

/**
 * @param bounds   Model bounding box (metres), or null/undefined when no model is loaded.
 * @param maxOrder Image-Source order (reflections handled exactly by ISM).
 * @param step     Slider step the results are rounded to.
 * @returns null when the bounding box is missing or degenerate.
 */
export function estimateRayCount(
  bounds: RayCountBounds | null | undefined,
  maxOrder: number,
  step: number,
): RayCountEstimate | null {
  if (!bounds) return null;

  const x = bounds.max[0] - bounds.min[0];
  const y = bounds.max[1] - bounds.min[1];
  const z = bounds.max[2] - bounds.min[2];
  const volume = x * y * z;
  const surface = 2 * (x * y + y * z + z * x);
  if (!(volume > 0) || !(surface > 0)) return null;

  const meanFreePath = (4 * volume) / surface;
  const earlyPath = Math.max(1, maxOrder) * meanFreePath;
  const rindel = (8 * Math.PI * earlyPath * earlyPath) / PYROOMACOUSTICS_RAY_TRACING_MIN_RESOLVED_SURFACE_AREA;

  const r = PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS;
  const lateDensity =
    (PYROOMACOUSTICS_RAY_TRACING_TARGET_HITS_PER_BIN * volume) /
    (Math.PI * r * r * DEFAULT_SPEED_OF_SOUND * PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE);

  const min = clampRays(roundToStep(rindel, step));
  const recommended = clampRays(roundToStep(Math.max(rindel, lateDensity), step));
  return { min, recommended, volume };
}
