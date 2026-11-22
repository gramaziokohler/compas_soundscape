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
