/**
 * Slicing of the PFFDTD strength-G volume and the texel grids the field
 * plane is drawn on (pure functions).
 *
 * Volume files (backend services/pffdtd_job.py): little-endian, row-major z,
 * then y, then x. SPL = float32 [nz·ny·nx] dB strength G (NaN outside);
 * mask = uint8 [nz·ny·nx] (0 air, 1 wall, 2 outside).
 *
 * A slice keeps the lattice cells as texels in-plane (nearest) and
 * interpolates linearly in energy between the two lattice layers on either
 * side of the slice position; the mask takes the nearest layer.
 */

import {
  PFFDTD_MASK,
  type PffdtdFieldBlock,
  type PffdtdFieldVolume,
  type PffdtdSlice,
  type PffdtdSliceAxis,
  type PffdtdTexelGrid,
} from '@/types/pffdtd';

type Vec3 = [number, number, number];

const UNIT: Record<PffdtdSliceAxis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** In-plane axes of a slice: u then v (u × v points along +normal, or −y for the y slice). */
const SLICE_AXES: Record<PffdtdSliceAxis, [PffdtdSliceAxis, PffdtdSliceAxis]> = {
  z: ['x', 'y'],
  x: ['y', 'z'],
  y: ['x', 'z'],
};

interface AxisInfo {
  origin: number;
  step: number;
  count: number;
}

function axisInfo(vol: PffdtdFieldVolume, axis: PffdtdSliceAxis): AxisInfo {
  if (axis === 'x') return { origin: vol.x0, step: vol.dx, count: vol.nx };
  if (axis === 'y') return { origin: vol.y0, step: vol.dy, count: vol.ny };
  return { origin: vol.z0, step: vol.dz, count: vol.nz };
}

/** Range (m) of lattice node positions along an axis. */
export function volumeAxisRange(vol: PffdtdFieldVolume, axis: PffdtdSliceAxis): { min: number; max: number } {
  const { origin, step, count } = axisInfo(vol, axis);
  return { min: origin, max: origin + Math.max(0, count - 1) * step };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Default slice position on an axis: the field-plane (listener) height for horizontal slices, else the middle. */
export function defaultSlicePosition(block: PffdtdFieldBlock, vol: PffdtdFieldVolume, axis: PffdtdSliceAxis): number {
  const { min, max } = volumeAxisRange(vol, axis);
  return axis === 'z' ? clamp(block.z, min, max) : (min + max) / 2;
}

export function defaultSlice(block: PffdtdFieldBlock, vol: PffdtdFieldVolume): PffdtdSlice {
  return { axis: 'z', position: defaultSlicePosition(block, vol, 'z') };
}

/** Texel grid of the horizontal animation plane (and of plane SPL maps in old results). */
export function planeTexelGrid(block: PffdtdFieldBlock): PffdtdTexelGrid {
  return {
    nu: block.nx,
    nv: block.ny,
    du: block.dx,
    dv: block.dy,
    origin: [block.x0, block.y0, block.z],
    uDir: UNIT.x,
    vDir: UNIT.y,
  };
}

export interface PffdtdVolumeSlice {
  grid: PffdtdTexelGrid;
  /** dB strength G per texel (NaN outside). */
  values: Float32Array;
  mask: Uint8Array;
}

/** Strength-G slice through the volume (`spl` and `mask` are [nz·ny·nx]). */
export function sliceVolume(
  vol: PffdtdFieldVolume,
  spl: Float32Array,
  mask: Uint8Array | null,
  slice: PffdtdSlice,
): PffdtdVolumeSlice {
  const [uAxis, vAxis] = SLICE_AXES[slice.axis];
  const u = axisInfo(vol, uAxis);
  const v = axisInfo(vol, vAxis);
  const n = axisInfo(vol, slice.axis);

  const c = clamp((slice.position - n.origin) / (n.step || 1), 0, n.count - 1);
  const k0 = Math.floor(c);
  const k1 = Math.min(k0 + 1, n.count - 1);
  const t = c - k0;
  const kn = t < 0.5 ? k0 : k1;
  const position = n.origin + c * n.step;

  // Flat index of lattice node (ix, iy, iz) = (iz·ny + iy)·nx + ix, expressed per slice axis.
  const stride: Record<PffdtdSliceAxis, number> = { x: 1, y: vol.nx, z: vol.nx * vol.ny };
  const su = stride[uAxis];
  const sv = stride[vAxis];
  const sn = stride[slice.axis];

  const values = new Float32Array(u.count * v.count);
  const outMask = new Uint8Array(u.count * v.count);
  for (let iv = 0; iv < v.count; iv++) {
    for (let iu = 0; iu < u.count; iu++) {
      const base = iu * su + iv * sv;
      const i0 = base + k0 * sn;
      const i1 = base + k1 * sn;
      const a = spl[i0];
      const b = spl[i1];
      const o = iv * u.count + iu;
      if (Number.isFinite(a) && Number.isFinite(b)) {
        values[o] = 10 * Math.log10((1 - t) * Math.pow(10, a / 10) + t * Math.pow(10, b / 10));
      } else {
        values[o] = kn === k0 ? a : b;
      }
      outMask[o] = mask ? mask[base + kn * sn] : PFFDTD_MASK.AIR;
    }
  }

  const origin: Vec3 = [vol.x0, vol.y0, vol.z0];
  origin['xyz'.indexOf(slice.axis)] = position;
  return {
    grid: { nu: u.count, nv: v.count, du: u.step, dv: v.step, origin, uDir: UNIT[uAxis], vDir: UNIT[vAxis] },
    values,
    mask: outMask,
  };
}

/** Height (m) of the animation plane a card asks for: its horizontal slice, else the recorded plane. */
export function animationHeight(block: PffdtdFieldBlock, slice: PffdtdSlice | null | undefined): number {
  return slice?.axis === 'z' ? slice.position : block.z;
}

/**
 * Whether the recorded animation plane (`block.z`, a grid node height) is the
 * one asked for at `z`: within half a grid cell. Always true without a volume
 * (old results: the plane cannot move).
 */
export function animationPlaneMatches(block: PffdtdFieldBlock, z: number): boolean {
  const vol = block.volume;
  if (!vol) return true;
  const halfCell = vol.dz / Math.max(1, vol.stride) / 2;
  return Math.abs(z - block.z) <= halfCell + 1e-6;
}
