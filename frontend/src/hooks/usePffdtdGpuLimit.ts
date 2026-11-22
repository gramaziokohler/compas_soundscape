'use client';

import { useMemo } from 'react';
import { useAcousticRegionBounds } from '@/hooks/useAcousticRegionBounds';
import { usePffdtdGpuMemory } from '@/hooks/usePffdtdGpuMemory';
import { pffdtdMaxGridProduct } from '@/lib/acoustics/pffdtd-grid';
import type { PffdtdGpuMemory, PffdtdPrecision } from '@/types/pffdtd';

/**
 * The GPU limit of a wave solve over the acoustic region's box: the largest fmax · PPW whose grid
 * fits the GPU memory available now (live from the backend, or its configured budget), at this
 * precision. Single precision halves the bytes per point, so its limit is 2^(1/3) ≈ 1.26× higher.
 * `maxProduct` is null until both the box and the memory are known.
 */
export function usePffdtdGpuLimit(precision: PffdtdPrecision): {
  maxProduct: number | null;
  memory: PffdtdGpuMemory | null;
} {
  const { bounds } = useAcousticRegionBounds();
  const memory = usePffdtdGpuMemory();
  const available = memory?.available_bytes ?? null;
  const maxProduct = useMemo(() => {
    if (!bounds || available === null) return null;
    const extents = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]) as [number, number, number];
    return pffdtdMaxGridProduct(extents, precision, available);
  }, [bounds, available, precision]);
  return { maxProduct, memory };
}
