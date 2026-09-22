'use client';

import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { SANDBOX_SPHERE_BOUNCE } from '@/utils/constants';

/**
 * "Dropped ball" bounce curve, normalized to a 0..1 amplitude. Mirrors the
 * sidebar expand handle keyframes: one large bounce, one small bounce, then a
 * rest for the remainder of the period.
 */
function bounceCurve(p: number): number {
  if (p < 0.06) return p / 0.06; // large bounce rise
  if (p < 0.16) return 1 - ((p - 0.06) / 0.10) * 0.75; // large bounce fall
  if (p < 0.24) return 0.25 - ((p - 0.16) / 0.08) * 0.25; // land
  if (p < 0.30) return ((p - 0.24) / 0.06) * 0.375; // small bounce rise
  if (p < 0.40) return 0.375 * (1 - (p - 0.30) / 0.10); // small bounce land
  return 0; // rest
}

/**
 * Bounce the Home stage's pinned Sample sphere vertically, with the same rhythm
 * as the sidebar expand-handle animation.
 */
export function useSpeckleHomeSphereBounce({
  isViewerReady,
  enabled,
}: {
  isViewerReady: boolean;
  enabled: boolean;
}): void {
  useEffect(() => {
    if (!isViewerReady || !enabled) return;
    const { viewer, coordinator } = useSpeckleEngineStore.getState();
    const manager = coordinator?.getSoundSphereManager();
    if (!viewer || !manager) return;

    let rafId: number | null = null;
    const start = performance.now();

    const tick = () => {
      const phase =
        ((performance.now() - start) % SANDBOX_SPHERE_BOUNCE.PERIOD_MS) /
        SANDBOX_SPHERE_BOUNCE.PERIOD_MS;
      manager.setHomeBounceOffset(bounceCurve(phase) * SANDBOX_SPHERE_BOUNCE.AMPLITUDE_M);
      viewer.requestRender();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      manager.setHomeBounceOffset(0);
    };
  }, [isViewerReady, enabled]);
}
