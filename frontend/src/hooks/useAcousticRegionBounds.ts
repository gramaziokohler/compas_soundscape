'use client';

import { useMemo } from 'react';
import { useAcousticLayerStore, useFileUploadStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { computeSpeckleObjectsBounds } from '@/lib/three/speckle-object-bounds';

export interface AcousticRegionBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Bounding box of the acoustic region (the geometry the simulation actually runs on). Falls back
 * to the whole model — Speckle World box, then the legacy vertex-upload `geometryBounds` — when
 * no region is resolved yet or the region is the whole model. `isAcousticLayer` tells which.
 */
export function useAcousticRegionBounds(): { bounds: AcousticRegionBounds | null; isAcousticLayer: boolean } {
  const viewer = useSpeckleEngineStore((s) => s.viewer);
  const resonanceRoomBoxes = useSpeckleEngineStore((s) => s.resonanceRoomBoxes);
  const geometryBounds = useFileUploadStore((s) => s.geometryBounds);
  const acousticGeometryIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const acousticBounds = useMemo(
    () => (isWholeModel ? null : computeSpeckleObjectsBounds(viewer, acousticGeometryIds)),
    [viewer, acousticGeometryIds, isWholeModel]
  );
  // World box is read every render (cheap) since it fills asynchronously after load.
  const bounds =
    acousticBounds ??
    ((viewer && resonanceRoomBoxes?.calculateBoundsFromSpeckleBatches(viewer)) || geometryBounds);
  return { bounds: bounds ?? null, isAcousticLayer: !!acousticBounds };
}
