import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { RECEIVER_CONFIG } from '@/utils/constants';
import type { SoundEvent } from '@/types';
import type { AuralizationConfig } from '@/types/audio';

interface SoundSpheresProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  selectedVariants: Record<number, number>;
  scaleForSounds: number;
  auralizationConfig?: AuralizationConfig;
}

export function useSpeckleSoundSpheres({
  isViewerReady,
  soundscapeData,
  selectedVariants,
  scaleForSounds,
  auralizationConfig,
}: SoundSpheresProps) {
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

    coordinator.updateSoundSpheres(
      soundscapeData,
      selectedVariants,
      scaleForSounds,
      auralizationConfigRef.current,
      cameraFrontPosition
    );
  }, [isViewerReady, soundscapeData, selectedVariants, scaleForSounds]);
}
