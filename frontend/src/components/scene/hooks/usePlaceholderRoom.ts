'use client';

import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store';
import {
  fitCameraToBounds,
  getPlaceholderRoomBounds,
  getSandboxStageBounds,
  installSandboxCameraFarPlane,
} from '@/lib/three/placeholder-room-manager';

export {
  getPlaceholderRoomBounds,
  getSandboxStageBounds,
  fitCameraToBounds,
} from '@/lib/three/placeholder-room-manager';

interface UsePlaceholderRoomProps {
  isViewerReady: boolean;
  enabled: boolean;
}

/**
 * Sandbox (Home) stage setup.
 *
 * The Home page is an empty stage: no shoebox geometry and no bounding-box
 * wireframe are drawn. We still publish the placeholder AABB so the ground grid
 * centers correctly, the sandbox far plane stays finite (the empty scene would
 * otherwise write NaN into the projection matrix), and reset-zoom has a target.
 */
export function usePlaceholderRoom({ isViewerReady, enabled }: UsePlaceholderRoomProps): void {
  useEffect(() => {
    if (!isViewerReady || !enabled) return;

    const { viewer, cameraController } = useSpeckleEngineStore.getState();
    if (!viewer) return;

    const scene = viewer.getRenderer().scene;
    if (!scene) return;

    // Room AABB drives the grid geometry; stage AABB (whole grid) drives the far
    // plane and the default camera framing.
    const bounds = getPlaceholderRoomBounds();
    const stageBounds = getSandboxStageBounds();
    const restoreFarPlane = installSandboxCameraFarPlane(viewer, cameraController, stageBounds);
    useUIStore.getState().setSpeckleBounds(bounds);
    fitCameraToBounds(cameraController, stageBounds);
    viewer.requestRender(8);
    const t0 = window.setTimeout(() => viewer.requestRender(), 0);
    const t1 = window.setTimeout(() => viewer.requestRender(), 100);
    const t2 = window.setTimeout(() => viewer.requestRender(), 200);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      restoreFarPlane();
    };
  }, [isViewerReady, enabled]);
}
