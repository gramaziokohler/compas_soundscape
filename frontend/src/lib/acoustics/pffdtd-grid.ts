/**
 * Small PFFDTD grid helpers shared by the wave-based card UI.
 *
 * The backend plans the real grid (utils/pffdtd_grid.py, which may round h to
 * align walls); these are the frontend estimates shown while editing.
 */

import { PFFDTD } from '@/utils/constants';
import type { PffdtdPrecision } from '@/types/pffdtd';

/** Grid spacing estimate h = c / (fmax · PPW) in metres. */
export function pffdtdGridSpacing(fmax: number, ppw: number): number {
  return PFFDTD.SPEED_OF_SOUND / (fmax * ppw);
}

/** Minimum source / listener distance to a surface for this grid (metres). */
export function pffdtdSeedClearance(fmax: number, ppw: number): number {
  return PFFDTD.SEED_CLEARANCE_CELLS * pffdtdGridSpacing(fmax, ppw);
}

/**
 * Grid size, GPU memory and solve time of one run over a box (the acoustic region), as the backend
 * plans it (plan_grid): ceil(extent / h) + halo cells per axis. `duration` null = unknown (no runtime).
 */
export function pffdtdGridEstimate(
  extents: [number, number, number],
  h: number,
  precision: PffdtdPrecision,
  duration: number | null,
): { nodes: number; bytes: number; runtimeS: number | null } {
  const nodes = extents.reduce((n, l) => n * (Math.ceil(Math.max(l, 0) / h) + PFFDTD.GRID_PADDING_CELLS), 1);
  const ts = (h * PFFDTD.COURANT_CART) / PFFDTD.SPEED_OF_SOUND;
  const runtimeS = duration === null
    ? null
    : PFFDTD.RUN_OVERHEAD_S + (nodes * Math.ceil(duration / ts)) / PFFDTD.NODE_UPDATES_PER_S[precision];
  return { nodes, bytes: nodes * PFFDTD.BYTES_PER_NODE[precision], runtimeS };
}

/** Bisection steps of pffdtdMaxGridProduct: the product is found to 2^-40 of its search range. */
const MAX_PRODUCT_BISECTIONS = 40;

/**
 * The largest fmax · PPW whose grid over this box fits `availableBytes` of GPU memory. The grid
 * spacing is h = c / (fmax · PPW), so memory depends on that product alone: one GPU limit links
 * the max frequency (or the hybrid's crossover) and the points per wavelength. The node count only
 * grows with the product, so it is found by bisection over the same estimate as pffdtdGridEstimate
 * (the cube-root PPW reduction of the BRAS benchmark's _plan_domain solves the same fit by steps).
 * Infinity when even the finest grid of the sliders fits; 0 when not even the padding fits.
 */
export function pffdtdMaxGridProduct(
  extents: [number, number, number],
  precision: PffdtdPrecision,
  availableBytes: number,
): number {
  const fits = (product: number) =>
    pffdtdGridEstimate(extents, PFFDTD.SPEED_OF_SOUND / product, precision, null).bytes <= availableBytes;
  let hi = PFFDTD.FMAX_MAX * PFFDTD.PPW_MAX;
  if (fits(hi)) return Infinity;
  let lo = 0;
  for (let i = 0; i < MAX_PRODUCT_BISECTIONS; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * A "GPU max" tick for a slider at `value`, or none when the limit is beyond the slider's range
 * (everything fits) or the limit is unknown. A limit below the range is drawn at the range's start:
 * no setting fits, and the grid estimate says so.
 */
export function gpuMaxMarker(
  value: number | null,
  min: number,
  max: number,
): Array<{ value: number; label: string; tone: 'error' }> {
  if (value === null || !Number.isFinite(value) || value >= max) return [];
  return [{ value: Math.max(value, min), label: PFFDTD.GPU_MAX_MARKER_LABEL, tone: 'error' }];
}

const gbText = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;

/**
 * Whether a wave grid of spacing `h` over the acoustic region's box fits the GPU memory a wave
 * solve can use now, and the warning shown when it does not (null when it fits or is unknown).
 */
export function waveGridFit(
  extents: [number, number, number] | null,
  h: number | null,
  precision: PffdtdPrecision,
  duration: number | null,
  availableBytes: number | null,
): { grid: { nodes: number; bytes: number; runtimeS: number | null } | null; tooLarge: boolean; warning: string | null } {
  if (!extents || h === null) return { grid: null, tooLarge: false, warning: null };
  const grid = pffdtdGridEstimate(extents, h, precision, duration);
  const tooLarge = availableBytes !== null && grid.bytes > availableBytes;
  const warning = tooLarge && availableBytes !== null
    ? `The grid needs ${gbText(grid.bytes)} of GPU memory, ${gbText(availableBytes)} available`
      + (precision === 'double' ? ': switch to single precision, or lower' : ': lower')
      + ' the max frequency or the points per wavelength.'
    : null;
  return { grid, tooLarge, warning };
}
