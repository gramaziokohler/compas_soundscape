/**
 * Decoding and combination of PFFDTD field-plane data (pure functions).
 *
 * File formats (backend services/pffdtd_job.py): little-endian, row-major y
 * then x. SPL = float32 [ny·nx] dB strength G (NaN outside); frames = int8
 * [frames·ny·nx] (value = q / 127 · vmax); mask = uint8 [ny·nx].
 */

import type { PffdtdFieldBlock, PffdtdLegendBounds } from '@/types/pffdtd';

/** Finite min / max of an SPL map (dB); null when nothing is finite. */
export function splRange(spl: Float32Array): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < spl.length; i++) {
    const v = spl[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/**
 * Energy sum of several sources' strength-G maps:
 * G = 10·log10(Σ 10^(Gᵢ/10)). A cell is NaN when any source is NaN there
 * (outside the room for one source is outside for all).
 */
export function energySumSpl(maps: Float32Array[]): Float32Array {
  const n = maps[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    let valid = true;
    for (const m of maps) {
      const v = m[i];
      if (!Number.isFinite(v)) { valid = false; break; }
      e += Math.pow(10, v / 10);
    }
    out[i] = valid && e > 0 ? 10 * Math.log10(e) : NaN;
  }
  return out;
}

/**
 * Colour-bar range of a source's SPL map: the backend's per-source min / max,
 * or the finite range of the computed map ("All sources" energy sum).
 */
export function splDisplayRange(
  block: PffdtdFieldBlock,
  spl: Float32Array | undefined,
  sourceId: string,
): { min: number; max: number } | null {
  const source = block.sources.find((s) => s.source_id === sourceId);
  if (source) return { min: source.spl_min_db, max: source.spl_max_db };
  return spl ? splRange(spl) : null;
}

/** The user's legend bounds when valid (finite, min < max), else the default range. */
export function applyLegendBounds(
  range: { min: number; max: number } | null,
  legend: PffdtdLegendBounds | null | undefined,
): { min: number; max: number } | null {
  if (legend && Number.isFinite(legend.min) && Number.isFinite(legend.max) && legend.min < legend.max) return legend;
  return range;
}

/** Number of int8 samples per animation frame. */
export function frameSize(nx: number, ny: number): number {
  return nx * ny;
}

/** View of one animation frame (no copy). */
export function frameView(frames: Int8Array, frame: number, nx: number, ny: number): Int8Array {
  const size = frameSize(nx, ny);
  return frames.subarray(frame * size, (frame + 1) * size);
}
