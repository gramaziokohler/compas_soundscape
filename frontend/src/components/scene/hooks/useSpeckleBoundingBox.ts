import { useEffect } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { BoundingBoxBounds } from '@/lib/three/BoundingBoxManager';
import type { SoundEvent } from '@/types';

interface BoundingBoxProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  showBoundingBox?: boolean;
  resonanceAudioConfig?: { roomMaterials?: any };
  refreshBoundingBoxTrigger: number;
  onBoundsComputed?: (bounds: { min: [number, number, number]; max: [number, number, number] }) => void;
  roomScale: { x: number; y: number; z: number };
  draggedBoundsOverride: BoundingBoxBounds | null;
}

export function useSpeckleBoundingBox({
  isViewerReady,
  soundscapeData,
  showBoundingBox,
  resonanceAudioConfig,
  refreshBoundingBoxTrigger,
  onBoundsComputed,
  roomScale,
  draggedBoundsOverride,
}: BoundingBoxProps) {
  // ============================================================================
  // Effect - Bounding Box Visualization (Resonance Audio Room)
  // ============================================================================
  useEffect(() => {
    const { viewer, boundingBoxManager } = useSpeckleEngineStore.getState();
    if (!boundingBoxManager || !isViewerReady || !viewer) return;

    // Calculate effective bounds from Speckle viewer (primary method)
    let effectiveBounds = boundingBoxManager.calculateBoundsFromSpeckleBatches(viewer);

    // Fallback to auto-calculate from sound positions
    if (!effectiveBounds) {
      const soundPositions: THREE.Vector3[] = [];
      if (soundscapeData) {
        soundscapeData.forEach((sound) => {
          if (sound.position) {
            soundPositions.push(new THREE.Vector3(...sound.position));
          }
        });
      }
      effectiveBounds = boundingBoxManager.calculateEffectiveBounds(null, soundPositions);
    }

    // Apply room scale around center of bounds
    let scaledBounds = effectiveBounds;
    if (effectiveBounds && (roomScale.x !== 1 || roomScale.y !== 1 || roomScale.z !== 1)) {
      const [minX, minY, minZ] = effectiveBounds.min;
      const [maxX, maxY, maxZ] = effectiveBounds.max;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const halfW = ((maxX - minX) / 2) * roomScale.x;
      const halfH = ((maxY - minY) / 2) * roomScale.y;
      const halfD = ((maxZ - minZ) / 2) * roomScale.z;
      scaledBounds = {
        min: [cx - halfW, cy - halfH, cz - halfD],
        max: [cx + halfW, cy + halfH, cz + halfD],
      };
    }

    const resolvedBounds = draggedBoundsOverride ?? scaledBounds;

    // Notify parent of computed bounds (for Resonance Audio room dimensions)
    if (resolvedBounds && onBoundsComputed) {
      onBoundsComputed(resolvedBounds);
    }

    const config = {
      roomMaterials: resonanceAudioConfig?.roomMaterials,
      visible: showBoundingBox && !!resolvedBounds,
    };

    boundingBoxManager.updateBoundingBox(resolvedBounds, config);

    // Request render update
    viewer.requestRender(8); // RENDER_RESET
    setTimeout(() => viewer.requestRender(), 0);
    setTimeout(() => viewer.requestRender(), 100);
    setTimeout(() => viewer.requestRender(), 200);
  }, [
    isViewerReady,
    soundscapeData,
    showBoundingBox,
    resonanceAudioConfig?.roomMaterials,
    refreshBoundingBoxTrigger,
    onBoundsComputed,
    roomScale,
    draggedBoundsOverride,
  ]);
}
