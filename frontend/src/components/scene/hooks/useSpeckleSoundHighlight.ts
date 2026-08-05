import { useEffect, useRef } from 'react';
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
  /** Simulation-time source/receiver positions. Reactivity signal only — forces this
   *  hook to re-run whenever the active simulation changes so the base-color reset
   *  below clears the mismatch-red on spheres that are no longer out of position. */
  activeSimulationPositions?: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
    soundToPosKey?: Record<string, string>;
  } | null;
}

export function useSpeckleSoundHighlight({
  isViewerReady,
  selectedCardIndex,
  soundscapeData,
  selectedVariants,
  activeSimulationPositions,
}: SoundHighlightProps) {
  const expandedSoundCardIndex = useUIStore(s => s.expandedSoundCardIndex);
  const zoomToSoundCardTrigger = useUIStore(s => s.zoomToSoundCardTrigger);

  // Keep a ref so the zoom effect can read the latest soundscapeData without
  // listing it as a dependency (prevents re-zooming when data populates on nav).
  const soundscapeDataRef = useRef(soundscapeData);
  soundscapeDataRef.current = soundscapeData;

  // Mesh the drag gizmo is currently attached to via the highlight-follow logic —
  // avoids re-attaching on every effect re-run and detects mesh recreation.
  const dragTargetSphereRef = useRef<THREE.Mesh | null>(null);

  // Note: Speckle object coloring (linked/diverse) is handled by the context's FilteringExtension.
  // This effect only handles sound sphere highlighting.
  // Priority: sidebar-expanded card (expandedSoundCardIndex) > scene-selected card (selectedCardIndex)
  useEffect(() => {
    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !soundscapeData || !coordinator) return;

    const soundSphereManager = coordinator.getSoundSphereManager();
    if (!soundSphereManager) return;

    const sphereMeshes = soundSphereManager.getSoundSphereMeshes();

    // Reset all sphere colors — pending spheres stay muted gray, generated spheres stay primary.
    // Mismatched spheres (userData.simMismatch, set by useSpeckleSimulationMismatch) stay red
    // so the mismatch coloring survives selection changes.
    sphereMeshes.forEach(sphere => {
      const material = sphere.material as THREE.MeshStandardMaterial;
      if (material.color) {
        const isPending = (sphere.userData.soundEvent as any)?.isPending;
        const isMismatched = sphere.userData.simMismatch === true;
        material.color.setHex(
          isMismatched
            ? getCssColorHex('--color-error')
            : getCssColorHex(isPending ? '--color-secondary-hover-static' : '--color-primary'),
        );
      }
    });

    // Sidebar expansion takes priority; fall back to scene-driven selection
    const effectiveIndex = expandedSoundCardIndex ?? selectedCardIndex;

    let highlightedSphere: THREE.Mesh | undefined;
    if (effectiveIndex !== null) {
      const selectedSound = soundscapeData.find((sound: any) => {
        const promptIdx = (sound as any).prompt_index ?? 0;
        return promptIdx === effectiveIndex;
      });

      if (selectedSound && (selectedSound.entity_index === undefined || selectedSound.entity_index === null)) {
        highlightedSphere = sphereMeshes.find(s => s.userData.soundEvent?.id === selectedSound.id);
      }
    }

    if (highlightedSphere) {
      const material = highlightedSphere.material as THREE.MeshStandardMaterial;
      // Keep mismatched spheres red — do not apply the selection highlight over the mismatch color.
      if (material.color && highlightedSphere.userData.simMismatch !== true) {
        material.color.setHex(getCssColorHex('--color-success'));
        material.needsUpdate = true;
      }
    }

    // Drag gizmo follows the highlighted sound sphere: when a different card is
    // expanded/selected (or the current one loses its highlight), re-attach the
    // gizmo to the highlighted sphere so it never stays on a previously clicked one.
    const dragHandler = coordinator.getDragHandler();
    if (dragHandler && !dragHandler.getIsDragging()) {
      if (highlightedSphere) {
        const attached = dragHandler.getSelectedObjects()?.[0] as THREE.Mesh | undefined;
        if (attached !== highlightedSphere) {
          dragHandler.selectObjects([highlightedSphere]);
        }
        dragTargetSphereRef.current = highlightedSphere;
      } else {
        // No highlighted sphere: detach the gizmo from ANY attached sound sphere.
        // This covers gizmos attached by the event bridge click handler (where
        // dragTargetSphereRef is never set), so collapsing the card clears the
        // gizmo even when it wasn't attached by this effect. Receiver gizmos are
        // untouched (only 'sound' is deselected).
        const attached = dragHandler.getSelectedObjects()?.[0];
        if (attached?.userData.customObjectType === 'sound') {
          dragHandler.deselectObjects();
        }
        dragTargetSphereRef.current = null;
      }
    }

    viewer?.requestRender();
  }, [isViewerReady, selectedCardIndex, expandedSoundCardIndex, soundscapeData, selectedVariants, activeSimulationPositions]);

  // Zoom to sound sphere when card is double-clicked in sidebar
  useEffect(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!zoomToSoundCardTrigger || !isViewerReady || !coordinator) return;

    const { index } = zoomToSoundCardTrigger;
    const sound = soundscapeDataRef.current?.find((s: any) => ((s as any).prompt_index ?? 0) === index);
    if (!sound) return;

    const soundSphereManager = coordinator.getSoundSphereManager();
    if (!soundSphereManager) return;

    const isNonZeroPos = (pos: [number, number, number]) =>
      pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0;

    const storedPos = soundSphereManager.getSpherePosition(sound.id);
    // Only use stored position when it's actually been placed (non-zero).
    // [0,0,0] means not yet resolved — fall back to the event's own position.
    const position =
      (storedPos && isNonZeroPos(storedPos))
        ? new THREE.Vector3(...storedPos)
        : (sound.position && isNonZeroPos(sound.position as [number, number, number]))
          ? new THREE.Vector3(...(sound.position as [number, number, number]))
          : null;

    if (position) {
      coordinator.zoomToPosition(position);
    }
  }, [zoomToSoundCardTrigger, isViewerReady]);
}
