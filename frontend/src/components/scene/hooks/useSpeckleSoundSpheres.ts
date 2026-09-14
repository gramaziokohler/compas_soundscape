import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useSpeckleStore } from '@/store';
import { RECEIVER_CONFIG, DARK_MODE } from '@/utils/constants';
import type { SoundEvent } from '@/types';
import type { AuralizationConfig } from '@/types/audio';
import type { EntitySurfaceInfo } from '@/lib/three/sound-sphere-manager';

interface SoundSpheresProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  selectedVariants: Record<number, number>;
  scaleForSounds: number;
  auralizationConfig?: AuralizationConfig;
}

/**
 * Resolve each linked object's world AABB and decide which prompts are "large"
 * surface sources. Uses the same object↔prompt links the coloring system uses
 * (speckleStore.objectSoundLinks), so a prompt's marker/gumball targets exactly
 * the objects it is linked to.
 */
function buildEntitySurfaceInfo(
  viewer: any,
  objectSoundLinks: Map<string, number>,
): EntitySurfaceInfo {
  const info: EntitySurfaceInfo = {
    largePrompts: new Set<number>(),
    objectIdsByPrompt: new Map<number, string[]>(),
    boxByPrompt: new Map<number, THREE.Box3>(),
  };
  if (!viewer || objectSoundLinks.size === 0) return info;

  const renderTree = viewer.getWorldTree?.()?.getRenderTree?.();
  objectSoundLinks.forEach((promptIdx, objectId) => {
    const ids = info.objectIdsByPrompt.get(promptIdx) ?? [];
    ids.push(objectId);
    info.objectIdsByPrompt.set(promptIdx, ids);

    let rvs: any[] = [];
    try {
      rvs = renderTree?.getRenderViewsForNodeId?.(objectId) ?? [];
    } catch {
      rvs = [];
    }
    for (const rv of rvs) {
      const aabb: THREE.Box3 | undefined = rv.aabb ?? rv.computeAABB?.();
      if (!aabb) continue;
      const existing = info.boxByPrompt.get(promptIdx);
      if (existing) existing.union(aabb);
      else info.boxByPrompt.set(promptIdx, aabb.clone());
    }
  });

  const size = new THREE.Vector3();
  info.boxByPrompt.forEach((box, promptIdx) => {
    box.getSize(size);
    if (Math.max(size.x, size.y, size.z) > DARK_MODE.LARGE_ENTITY_THRESHOLD_M) {
      info.largePrompts.add(promptIdx);
    }
  });

  return info;
}

export function useSpeckleSoundSpheres({
  isViewerReady,
  soundscapeData,
  selectedVariants,
  scaleForSounds,
  auralizationConfig,
}: SoundSpheresProps) {
  const objectSoundLinks = useSpeckleStore((s) => s.objectSoundLinks);

  const auralizationConfigRef = useRef<AuralizationConfig>(
    auralizationConfig || {
      enabled: false,
      impulseResponseUrl: null,
      impulseResponseBuffer: null,
      impulseResponseFilename: null,
      normalize: false,
    }
  );

  useEffect(() => {
    if (auralizationConfig) {
      auralizationConfigRef.current = auralizationConfig;
    }
  }, [auralizationConfig]);

  useEffect(() => {
    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    if (!coordinator || !isViewerReady || !viewer) return;

    let cameraFrontPosition: THREE.Vector3 | null = null;
    try {
      const camera = (viewer as any).getRenderer().renderingCamera;
      if (camera?.matrixWorld && camera?.position) {
        const mx: number[] = camera.matrixWorld.elements;
        const dx = -mx[8], dy = -mx[9], dz = -mx[10];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const d = RECEIVER_CONFIG.CAMERA_PLACEMENT_DISTANCE_M;
        cameraFrontPosition = new THREE.Vector3(
          camera.position.x + (dx / len) * d,
          camera.position.y + (dy / len) * d,
          camera.position.z + (dz / len) * d,
        );
      }
    } catch {
      // Camera not ready — sound falls through to its backend event position
    }

    const entitySurfaceInfo = buildEntitySurfaceInfo(viewer, objectSoundLinks);

    coordinator.updateSoundSpheres(
      soundscapeData ?? [],
      selectedVariants,
      scaleForSounds,
      auralizationConfigRef.current,
      cameraFrontPosition,
      entitySurfaceInfo
    );
  }, [isViewerReady, soundscapeData, selectedVariants, scaleForSounds, objectSoundLinks]);
}
