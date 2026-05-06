import { useEffect } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { getCssColorHex } from '@/utils/utils';
import { SIMULATION_POSITION_THRESHOLD } from '@/utils/constants';
import type { SoundEvent, ReceiverData } from '@/types';

interface SimulationMismatchProps {
  isViewerReady: boolean;
  activeSimulationPositions: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
  } | null;
  soundscapeData: SoundEvent[] | null;
  receivers: ReceiverData[];
}

/**
 * Colors sound spheres and receiver cubes light-red when they have moved more than
 * SIMULATION_POSITION_THRESHOLD from their simulation-time positions.
 * Only active when activeSimulationPositions is non-null (expanded completed card).
 */
export function useSpeckleSimulationMismatch({
  isViewerReady,
  activeSimulationPositions,
  soundscapeData,
  receivers,
}: SimulationMismatchProps) {
  useEffect(() => {
    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !coordinator) return;

    const soundSphereManager = coordinator.getSoundSphereManager();
    const receiverManager = coordinator.getReceiverManager();

    if (!activeSimulationPositions) {
      // No active simulation card expanded — restore default colors
      soundSphereManager?.getSoundSphereMeshes().forEach(mesh => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.color) mat.color.setHex(getCssColorHex('--color-primary'));
        mat.needsUpdate = true;
      });
      receiverManager?.getReceiverMeshes().forEach(mesh => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.color) mat.color.setHex(getCssColorHex('--color-receiver'));
        if (mat.emissive) mat.emissive.setHex(getCssColorHex('--color-receiver'));
        mat.needsUpdate = true;
      });
      viewer?.requestRender();
      return;
    }

    // Color sphere meshes
    soundSphereManager?.getSoundSphereMeshes().forEach(mesh => {
      const soundId: string | undefined = mesh.userData.soundEvent?.id;
      if (!soundId) return;
      const simPos = activeSimulationPositions.sources[soundId];
      if (!simPos) return;
      const p = mesh.position;
      const dist = Math.hypot(simPos[0] - p.x, simPos[1] - p.y, simPos[2] - p.z);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (dist > SIMULATION_POSITION_THRESHOLD) {
        mat.color.setHex(getCssColorHex('--color-error'));
      }
      mat.needsUpdate = true;
    });

    // Color receiver cube meshes
    receiverManager?.getReceiverMeshes().forEach(mesh => {
      const receiverId: string | undefined = mesh.userData.receiverId;
      if (!receiverId) return;
      const simPos = activeSimulationPositions.receivers[receiverId];
      if (!simPos) return;
      const p = mesh.position;
      const dist = Math.hypot(simPos[0] - p.x, simPos[1] - p.y, simPos[2] - p.z);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (dist > SIMULATION_POSITION_THRESHOLD) {
        mat.color.setHex(getCssColorHex('--color-error'));
        mat.emissive.setHex(getCssColorHex('--color-error'));
      } else {
        mat.color.setHex(getCssColorHex('--color-receiver'));
        mat.emissive.setHex(getCssColorHex('--color-receiver'));
      }
      mat.needsUpdate = true;
    });

    viewer?.requestRender();
  }, [isViewerReady, activeSimulationPositions, soundscapeData, receivers]);
}
