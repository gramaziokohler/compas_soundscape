'use client';

import { useMemo } from 'react';
import { useAcousticMaterialStore } from '@/store';
import { useAcousticRegionBounds } from '@/hooks/useAcousticRegionBounds';
import { estimateSchroederEyring, lowFrequencyMeanAbsorption, type EyringRoomEstimate } from '@/lib/acoustics/hybrid';

/**
 * Eyring estimate of the room a hybrid run plans its Schroeder crossover with, before any run has
 * measured it: the acoustic region's box and the low-frequency absorption of the assigned materials.
 */
export function useHybridRoomEstimate(): {
  estimate: EyringRoomEstimate | null;
  isAcousticLayer: boolean;
  meanAbsorption: number;
} {
  const { bounds, isAcousticLayer } = useAcousticRegionBounds();
  const materialAssignments = useAcousticMaterialStore((st) => st.materialAssignments);
  const availableMaterials = useAcousticMaterialStore((st) => st.availableMaterials);
  const meanAbsorption = useMemo(
    () => lowFrequencyMeanAbsorption(materialAssignments.values(), availableMaterials),
    [materialAssignments, availableMaterials]
  );
  const estimate = useMemo(() => estimateSchroederEyring(bounds, meanAbsorption), [bounds, meanAbsorption]);
  return { estimate, isAcousticLayer, meanAbsorption };
}
