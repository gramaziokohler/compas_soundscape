/**
 * PFFDTD (GPU finite-difference wave solver) types.
 *
 * Mirrors backend/routers/pffdtd.py (status, run, voxel preview) and the
 * `field` block of the results JSON written by services/pffdtd_job.py.
 * Field files are flat little-endian arrays: plane files row-major y then x,
 * volume files row-major z, then y, then x.
 */

import type { IRAcousticParameters } from '@/types/audio';

/** GET /api/pffdtd/status */
export interface PffdtdStatus {
  available: boolean;
  /** Why this deployment cannot run PFFDTD (null when available). */
  reason: string | null;
}

/** Wave-based card settings (sent as form fields to the run endpoint). */
export interface PffdtdSettings {
  simulation_mode: string; // "mono" | "foa"
  fmax: number;
  ppw: number;
  duration: number;
  air_absorption: boolean;
  /** Free positioning: after the run a moved listener / source gets its IR without re-running. */
  free_mode: PffdtdFreeMode;
  /** Candidate-grid spacing (m) of free positioning. */
  free_grid_spacing: number;
}

/**
 * 'listener': one run per source records a grid where listeners can move (forward).
 * 'source': one run per listener (×4 for FOA) records a grid where sources can move (reciprocal).
 */
export type PffdtdFreeMode = 'off' | 'listener' | 'source';

/** Milestones of an in-flight `pffdtd` job (unified /api/jobs `partial`). */
export interface PffdtdJobPartial {
  /** The run's voxelisation is done (the GPU solve follows). */
  voxelised?: boolean;
  /** Grid problems found while voxelising (e.g. the model leaks); unlocated. */
  problems?: PffdtdVoxelProblem[];
}

/** Result of a finished `pffdtd_animation` job (unified /api/jobs). */
export interface PffdtdAnimationJobResult {
  simulation_id: string;
  /** Height of the animated plane (grid node, m). */
  z: number;
  message: string;
}

/** Result of a finished `pffdtd` job (unified /api/jobs). */
export interface PffdtdJobResult {
  simulation_id: string;
  message: string;
  ir_files: string[];
  results_file: string;
  method: string;
}

// ─── Field outputs (results JSON `field` block) ──────────────────────────────

export interface PffdtdFieldAnimation {
  /** int8 file [frames * ny * nx]; value = q / 127 * vmax. */
  file: string;
  frames: number;
  times_ms: number[];
  vmax: number;
}

export interface PffdtdFieldSource {
  source_id: string;
  /**
   * float32 file [ny * nx] on the plane, dB strength G, NaN outside. Only in
   * results written before the volume (null when `volume` is present).
   */
  spl_file: string | null;
  /** Strength-G range over the air cells (volume, or plane for old results). */
  spl_min_db: number;
  spl_max_db: number;
  animation: PffdtdFieldAnimation | null;
}

export interface PffdtdFieldVolumeSource {
  source_id: string;
  /** float32 file [nz * ny * nx], dB strength G, NaN outside. */
  spl_volume_file: string | null;
}

/**
 * Strength-G lattice (every `stride`-th grid node). Node (ix, iy, iz) =
 * (x0 + ix·dx, y0 + iy·dy, z0 + iz·dz); it stands for the stride³ block
 * around it.
 */
export interface PffdtdFieldVolume {
  x0: number;
  y0: number;
  z0: number;
  dx: number;
  dy: number;
  dz: number;
  nx: number;
  ny: number;
  nz: number;
  stride: number;
  /** uint8 file [nz * ny * nx]: 0 air, 1 wall, 2 outside. */
  mask_file: string;
  sources: PffdtdFieldVolumeSource[];
}

/**
 * Field outputs. The top level is the horizontal animation plane: cell
 * (ix, iy) centre = (x0 + ix·dx, y0 + iy·dy, z). Strength G lives in
 * `volume`; results without it carry a plane map per source (`spl_file`).
 */
export interface PffdtdFieldBlock {
  z: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  /** uint8 file [ny * nx]: 0 air, 1 wall, 2 outside. */
  mask_file: string;
  band_hz: [number, number];
  reference: string;
  sources: PffdtdFieldSource[];
  volume?: PffdtdFieldVolume | null;
  /**
   * The run kept its voxel grid: wave animations are generated on demand
   * (POST /api/pffdtd/animation), which moves this plane to the chosen height.
   */
  animation_on_demand?: boolean;
}

/** Slice orientation: the axis normal to the slice ('z' = horizontal). */
export type PffdtdSliceAxis = 'x' | 'y' | 'z';

/** Strength-G slice through the volume: the plane `axis` = `position` (m, viewer frame). */
export interface PffdtdSlice {
  axis: PffdtdSliceAxis;
  position: number;
}

/** User-chosen colour-bar bounds of an SPL map (dB); replaces the backend's min / max. */
export interface PffdtdLegendBounds {
  min: number;
  max: number;
}

/**
 * A textured rectangle in the viewer: `nu` × `nv` texels, texel (iu, iv)
 * centred at origin + iu·du·uDir + iv·dv·vDir. Texel buffers are row-major
 * (v outer, u inner).
 */
export interface PffdtdTexelGrid {
  nu: number;
  nv: number;
  du: number;
  dv: number;
  origin: [number, number, number];
  uDir: [number, number, number];
  vDir: [number, number, number];
}

/** Mask values of `mask_file`. */
export const PFFDTD_MASK = {
  AIR: 0,
  WALL: 1,
  OUTSIDE: 2,
} as const;

/** The parts of the results JSON the frontend reads. */
export interface PffdtdResultsJson {
  simulation_id: string;
  method: string;
  results: Array<{
    source_id: string;
    receiver_id: string;
    acoustic_parameters?: Record<string, number | boolean | null>;
    fmax?: number;
  }>;
  grid?: { h?: number; fmax?: number };
  field?: PffdtdFieldBlock | null;
  free?: PffdtdFreeBlock | null;
}

// ─── Free positioning (results JSON `free` block, routers/pffdtd_free.py) ───

/** Candidate grid of a free-positioning run. */
export interface PffdtdFreeBlock {
  mode: Exclude<PffdtdFreeMode, 'off'>;
  foa: boolean;
  /** Effective spacing (m): the requested one, coarsened to fit the memory caps. */
  spacing_m: number;
  requested_spacing_m: number;
  /** A moved object snaps to the nearest valid point within this (m). */
  snap_radius_m: number;
  n_points: number;
  n_valid: number;
  connectivity_checked: boolean;
  /** The fixed side: source ids ('listener' mode) or receiver ids ('source' mode). */
  fixed_ids: string[];
}

/** Decoded GET /api/pffdtd/free-grid/{id}/points. */
export interface PffdtdFreeGridPoints {
  /** xyz per point (viewer frame, metres). */
  positions: Float32Array;
  /** 1 = reached by sound (a valid snap target). */
  valid: Uint8Array;
}

/** POST /api/pffdtd/free-ir */
export interface PffdtdFreeIRResponse {
  point_index: number;
  snapped_position: [number, number, number];
  distance_m: number;
  num_channels: number;
  sample_rate: number;
  duration_s: number;
  irs: Array<{ fixed_id: string; ir_file: string; acoustic_parameters?: IRAcousticParameters | null }>;
  render_ms: number;
}

/** Why a free-IR request produced no IR (409 / 404 from the endpoint). */
export type PffdtdFreeIRFailure = 'outside_grid' | 'superseded' | 'expired' | 'error';

// ─── Voxel preview ───────────────────────────────────────────────────────────

/** Result of a finished voxel-preview job. */
export interface PffdtdVoxelPreviewJobResult {
  preview_id: string;
  n_errors: number;
  n_warnings: number;
}

export type PffdtdProblemSeverity = 'error' | 'warning' | 'info';

export interface PffdtdVoxelProblem {
  id: string;
  severity: PffdtdProblemSeverity;
  code: string;
  title: string;
  detail: string;
  positions: [number, number, number][];
  radius_m?: number;
}

export interface PffdtdVoxelMaterial {
  index: number;
  /** Solver material name (m000, …). */
  name: string;
  /** Simulated material id (frontend id without the `pyroom_` prefix); null when unmapped. */
  material_id: string | null;
  count: number;
}

/** GET /api/pffdtd/voxel-preview/{id} */
export interface PffdtdVoxelPreviewPayload {
  preview_id: string;
  grid: {
    h: number;
    shape: [number, number, number];
    nodes: number;
    boundary_nodes: number;
    gpu_memory_gb: number;
  };
  n_points: number;
  materials: PffdtdVoxelMaterial[];
  rigid_count: number;
  problems: PffdtdVoxelProblem[];
  leak_check: { done: boolean; leak: boolean; note?: string };
}

/** Decoded GET /api/pffdtd/voxel-preview/{id}/points. */
export interface PffdtdVoxelPoints {
  /** xyz per point (viewer frame, metres). */
  positions: Float32Array;
  /** Material index per point (`PFFDTD_RIGID_MATERIAL_INDEX` = rigid). */
  materials: Uint8Array;
}

/** Overlay kinds drawn in the 3D viewer. */
export type PffdtdOverlayKind = 'voxels' | 'spl' | 'field';

/** "All sources (energy sum)" pseudo source id for the SPL map. */
export const PFFDTD_ALL_SOURCES = '__all__';
