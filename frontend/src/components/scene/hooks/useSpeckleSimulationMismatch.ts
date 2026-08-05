import { useEffect } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { getCssColorHex } from '@/utils/utils';
import { SIMULATION_POSITION_THRESHOLD, SIMULATION_POSITION_MATCH_THRESHOLD } from '@/utils/constants';
import type { ReceiverData, GridListenerData } from '@/types';

interface SimulationMismatchProps {
  isViewerReady: boolean;
  activeSimulationPositions: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
    soundToPosKey?: Record<string, string>;
  } | null;
  receivers: ReceiverData[];
  /** Grid listener configs — current points compared against sim-time receiver positions */
  gridListeners: GridListenerData[];
  /** Current sound events — used as a reactivity signal so the effect re-runs
   *  whenever a sound sphere is dragged to a new position. */
  soundscapeData?: unknown;
}

/**
 * Colors sound spheres and receiver cubes light-red when they have moved more than
 * SIMULATION_POSITION_THRESHOLD from their simulation-time positions.
 * Uses soundToPosKey (per-sound link to simulation position key) for accurate tracking
 * even when sounds move to entirely unsimulated positions.
 * Grid listener points are marked through the GridReceiverManager red mismatch overlay.
 */
export function useSpeckleSimulationMismatch({
  isViewerReady,
  activeSimulationPositions,
  receivers,
  gridListeners,
  soundscapeData,
}: SimulationMismatchProps) {
  useEffect(() => {
    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !coordinator) return;

    const soundSphereManager = coordinator.getSoundSphereManager();
    const receiverManager = coordinator.getReceiverManager();
    const gridReceiverManager = coordinator.getGridReceiverManager();

    if (!activeSimulationPositions) {
      // No active simulation: only clear the mismatch flags. Do NOT touch sphere
      // colors here — useSpeckleSoundHighlight owns the base/highlight color and
      // runs right after this hook, so resetting colors here would clobber the
      // highlight (and turn pending gray spheres blue) after every drag.
      soundSphereManager?.getSoundSphereMeshes().forEach(mesh => {
        mesh.userData.simMismatch = false;
      });
      receiverManager?.getReceiverMeshes().forEach(mesh => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.color) mat.color.setHex(getCssColorHex('--color-receiver'));
        if (mat.emissive) mat.emissive.setHex(getCssColorHex('--color-receiver'));
        mat.needsUpdate = true;
      });
      gridReceiverManager?.clearMismatchedPoints();
      viewer?.requestRender();
      return;
    }

    const { sources, soundToPosKey } = activeSimulationPositions;
    const simSourceEntries = Object.entries(sources);

    // Color sphere meshes — compare current position against sim position using soundToPosKey
    soundSphereManager?.getSoundSphereMeshes().forEach(mesh => {
      const soundId: string | undefined = mesh.userData.soundEvent?.id;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const p = mesh.position;

      const curX = p.x;
      const curY = p.y;
      const curZ = p.z;

      let isRed = false;

      if (soundId && soundToPosKey) {
        // Look up the sound's simulation-time position key
        const simPosKey = soundToPosKey[soundId];
        if (simPosKey) {
          const simPos = sources[simPosKey];
          if (simPos) {
            const dist = Math.hypot(simPos[0] - curX, simPos[1] - curY, simPos[2] - curZ);
            if (dist > SIMULATION_POSITION_THRESHOLD) isRed = true;
          }
        }
      }

      // New sound with no assigned simulation position: color it red UNLESS it sits
      // within SIMULATION_POSITION_MATCH_THRESHOLD of a simulated source — in which case
      // it inherits that position's IR and is considered "in a simulation position".
      if (!isRed && soundId && simSourceEntries.length > 0) {
        const nearSimSource = simSourceEntries.some(([, simPos]) =>
          Math.hypot(simPos[0] - curX, simPos[1] - curY, simPos[2] - curZ) <= SIMULATION_POSITION_MATCH_THRESHOLD,
        );
        if (!nearSimSource) isRed = true;
      }

      // Publish the mismatch state on the mesh so useSpeckleSoundHighlight does NOT
      // clobber the red when it resets all sphere colors on selection change.
      mesh.userData.simMismatch = isRed;
      // Only color red (mismatched) spheres. Non-red spheres are left untouched —
      // useSpeckleSoundHighlight (runs right after this hook) resets them to their
      // correct base/highlight color, so setting blue here would clobber both the
      // pending-gray state and the selection highlight.
      if (isRed) {
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

    // Mark grid listener points that drifted from their sim-time receiver positions.
    // Grid points are auto-computed (not draggable), so a mismatch means the grid
    // card's spacing / zOffset / bounding box changed after the simulation.
    const simReceivers = activeSimulationPositions.receivers;
    const gridMismatchIds = new Set<string>();
    for (const g of gridListeners) {
      g.points.forEach((pt, i) => {
        const pointId = `${g.id}-${i}`;
        const simPos = simReceivers[pointId];
        if (!simPos) return;
        const dist = Math.hypot(simPos[0] - pt[0], simPos[1] - pt[1], simPos[2] - pt[2]);
        if (dist > SIMULATION_POSITION_THRESHOLD) gridMismatchIds.add(pointId);
      });
    }
    gridReceiverManager?.setMismatchedPointIds(gridMismatchIds);

    viewer?.requestRender();
  }, [isViewerReady, activeSimulationPositions, receivers, gridListeners, soundscapeData]);
}
