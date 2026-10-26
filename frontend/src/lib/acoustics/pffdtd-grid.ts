/**
 * Small PFFDTD grid helpers shared by the wave-based card UI.
 *
 * The backend plans the real grid (utils/pffdtd_grid.py, which may round h to
 * align walls); these are the frontend estimates shown while editing.
 */

import { PFFDTD } from '@/utils/constants';

/** Grid spacing estimate h = c / (fmax · PPW) in metres. */
export function pffdtdGridSpacing(fmax: number, ppw: number): number {
  return PFFDTD.SPEED_OF_SOUND / (fmax * ppw);
}

/** Minimum source / listener distance to a surface for this grid (metres). */
export function pffdtdSeedClearance(fmax: number, ppw: number): number {
  return PFFDTD.SEED_CLEARANCE_CELLS * pffdtdGridSpacing(fmax, ppw);
}
