import { useEffect } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store/uiStore';
import { getCssColorHex } from '@/utils/utils';
import type { SoundEvent } from '@/types';

interface SoundHighlightProps {
  isViewerReady: boolean;
  selectedCardIndex: number | null;
  soundscapeData: SoundEvent[] | null;
  selectedVariants: Record<number, number>;
}

export function useSpeckleSoundHighlight({
  isViewerReady,
  selectedCardIndex,
  soundscapeData,
  selectedVariants,
}: SoundHighlightProps) {
  const expandedSoundCardIndex = useUIStore(s => s.expandedSoundCardIndex);
  const zoomToSoundCardTrigger = useUIStore(s => s.zoomToSoundCardTrigger);

  // Note: Speckle object coloring (linked/diverse) is handled by the context's FilteringExtension.
  // This effect only handles sound sphere highlighting.
  // Priority: sidebar-expanded card (expandedSoundCardIndex) > scene-selected card (selectedCardIndex)
  useEffect(() => {
    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !soundscapeData || !coordinator) return;

    const soundSphereManager = coordinator.getSoundSphereManager();
    if (!soundSphereManager) return;

    const sphereMeshes = soundSphereManager.getSoundSphereMeshes();

    // Reset all sphere colors to primary
    sphereMeshes.forEach(sphere => {
      const material = sphere.material as THREE.MeshStandardMaterial;
      if (material.color) {
        material.color.setHex(getCssColorHex('--color-primary'));
      }
    });

    // Sidebar expansion takes priority; fall back to scene-driven selection
    const effectiveIndex = expandedSoundCardIndex ?? selectedCardIndex;

    if (effectiveIndex !== null) {
      const selectedSound = soundscapeData.find((sound: any) => {
        const promptIdx = (sound as any).prompt_index ?? 0;
        return promptIdx === effectiveIndex;
      });

      if (selectedSound && (selectedSound.entity_index === undefined || selectedSound.entity_index === null)) {
        const sphere = sphereMeshes.find(s => s.userData.soundEvent?.id === selectedSound.id);
        if (sphere) {
          const material = sphere.material as THREE.MeshStandardMaterial;
          if (material.color) {
            material.color.setHex(getCssColorHex('--color-primary-hover'));
            material.needsUpdate = true;
          }
        }
      }
    }

    viewer?.requestRender();
  }, [isViewerReady, selectedCardIndex, expandedSoundCardIndex, soundscapeData, selectedVariants]);

  // Zoom to sound sphere when card is double-clicked in sidebar
  useEffect(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!zoomToSoundCardTrigger || !isViewerReady || !coordinator || !soundscapeData) return;

    const { index } = zoomToSoundCardTrigger;
    const sound = soundscapeData.find((s: any) => ((s as any).prompt_index ?? 0) === index);
    if (!sound) return;

    const soundSphereManager = coordinator.getSoundSphereManager();
    if (!soundSphereManager) return;

    const storedPos = soundSphereManager.getSpherePosition(sound.id);
    const position = storedPos
      ? new THREE.Vector3(...storedPos)
      : sound.position
        ? new THREE.Vector3(...(sound.position as [number, number, number]))
        : null;

    if (position) {
      coordinator.zoomToPosition(position);
    }
  }, [zoomToSoundCardTrigger, isViewerReady, soundscapeData]);
}
