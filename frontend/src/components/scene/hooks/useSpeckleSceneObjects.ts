import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { ReceiverData, SoundEvent } from '@/types';

interface SceneObjectsProps {
  isViewerReady: boolean;
  receivers: ReceiverData[];
  soundscapeData: SoundEvent[] | null;
  isFirstPersonMode: boolean;
  gridListenerPoints: [number, number, number][];
  gridListenerPointIds: string[];
  expandedGridListenerId?: string | null;
}

export function useSpeckleSceneObjects({
  isViewerReady,
  receivers,
  soundscapeData,
  isFirstPersonMode,
  gridListenerPoints,
  gridListenerPointIds,
  expandedGridListenerId,
}: SceneObjectsProps) {
  // Update receivers
  useEffect(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator || !isViewerReady) return;

    coordinator.updateReceivers(receivers);

    // If we're in FPS mode and the active receiver's position changed (e.g. the user
    // edited an x/y/z coordinate in the Listeners card), teleport the camera to the
    // new position while keeping the current look direction.
    if (isFirstPersonMode) {
      const activeId = coordinator.getActiveReceiverId();
      if (activeId) {
        const rm = coordinator.getReceiverManager();
        const mesh = rm?.getReceiverMeshes().find((m) => m.userData.receiverId === activeId);
        if (mesh) {
          coordinator.teleportFirstPerson(mesh.position.clone());
        }
      }
    }
  }, [isViewerReady, receivers, soundscapeData]);

  // Update grid listener points
  useEffect(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator || !isViewerReady) return;
    coordinator.updateGridListeners(gridListenerPoints, expandedGridListenerId, gridListenerPointIds);
  }, [isViewerReady, gridListenerPoints, expandedGridListenerId, gridListenerPointIds]);
}
