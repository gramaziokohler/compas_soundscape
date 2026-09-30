'use client';

import { useEffect, useRef } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { rotateCameraAzimuth } from '@/lib/three/placeholder-room-manager';
import { HOME_STAGE } from '@/utils/constants';

/**
 * Slowly spin the Home stage camera around the grid centre.
 *
 * The spin pauses while a pointer is held on the canvas and stops for good (for
 * the lifetime of the scene component) once the user drags the canvas — i.e.
 * orbits manually. A plain click, wheel zoom or UI interaction never stops it.
 */
export function useSpeckleHomeAutoRotate({
  isViewerReady,
  enabled,
}: {
  isViewerReady: boolean;
  enabled: boolean;
}): void {
  // Latch: survives effect re-runs (e.g. Home → model → Home) so it never resumes.
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!isViewerReady || !enabled || stoppedRef.current) return;
    const { viewer, cameraController } = useSpeckleEngineStore.getState();    if (!viewer || !cameraController) return;

    const canvas = viewer.getRenderer().renderer.domElement;
    const { SPEED_RAD_PER_S, ORBIT_DRAG_THRESHOLD_PX, MAX_FRAME_DELTA_MS } = HOME_STAGE.AUTO_ROTATE;

    let rafId: number | null = null;
    let lastTime = performance.now();
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;

    const stop = () => {
      stoppedRef.current = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      removeListeners();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) >= ORBIT_DRAG_THRESHOLD_PX) stop();
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === pointerId) pointerId = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    function removeListeners() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    }

    const tick = (now: number) => {
      const dt = Math.min(now - lastTime, MAX_FRAME_DELTA_MS);
      lastTime = now;      // Don't fight the user while a pointer is held (could still become a drag).
      if (pointerId === null && rotateCameraAzimuth(cameraController, (SPEED_RAD_PER_S * dt) / 1000)) {
        viewer.requestRender();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      removeListeners();
    };
  }, [isViewerReady, enabled]);
}
