'use client';

import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store';
import {
  PlaceholderRoomManager,
  fitCameraToBounds,
  installSandboxCameraFarPlane,
} from '@/lib/three/placeholder-room-manager';

export { getPlaceholderRoomBounds, fitCameraToBounds } from '@/lib/three/placeholder-room-manager';

interface UsePlaceholderRoomProps {
  isViewerReady: boolean;
  enabled: boolean;
}

export function usePlaceholderRoom({ isViewerReady, enabled }: UsePlaceholderRoomProps): void {
  useEffect(() => {
    if (!isViewerReady || !enabled) return;

    const { viewer, cameraController } = useSpeckleEngineStore.getState();
    if (!viewer) return;

    const scene = viewer.getRenderer().scene;
    if (!scene) return;

    const manager = new PlaceholderRoomManager(scene, () => viewer.requestRender(8));
    const bounds = manager.add();
    const restoreFarPlane = installSandboxCameraFarPlane(viewer, cameraController, bounds);
    useUIStore.getState().setSpeckleBounds(bounds);
    useUIStore.getState().setShowBoundingBox(true);
    fitCameraToBounds(cameraController, bounds);
    viewer.requestRender(8);
    const t0 = window.setTimeout(() => viewer.requestRender(), 0);
    const t1 = window.setTimeout(() => viewer.requestRender(), 100);
    const t2 = window.setTimeout(() => viewer.requestRender(), 200);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      restoreFarPlane();
      manager.dispose();
    };
  }, [isViewerReady, enabled]);
}
