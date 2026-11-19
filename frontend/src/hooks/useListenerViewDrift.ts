'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { FPS_CONTROLS_HINT } from '@/utils/constants';

type Orientation = { yaw: number; pitch: number; roll: number };

function differs(a: Orientation, b: Orientation): boolean {
  const t = FPS_CONTROLS_HINT.DRIFT_THRESHOLD_RAD;
  return Math.abs(a.yaw - b.yaw) > t || Math.abs(a.pitch - b.pitch) > t || Math.abs(a.roll - b.roll) > t;
}

export interface ListenerViewDrift {
  /** The visitor turned the first-person view away from the listener's saved orientation. */
  hasDrifted: boolean;
  /** Turn the first-person view back to the listener's saved orientation. */
  restore: () => void;
}

/**
 * Tracks whether the first-person view was turned away from the orientation the
 * listener was entered with (its saved yaw/pitch/roll, or the default look
 * direction), and turns it back on demand.
 *
 * The baseline is captured `BASELINE_SETTLE_MS` after entering a listener (the
 * entry itself places the camera) and re-captured whenever `listenerKey`
 * changes. Drift is read from `speckleEngineStore.currentCameraOrientation`.
 *
 * Usage:
 * ```tsx
 * const { hasDrifted, restore } = useListenerViewDrift(isFpsActive ? activeItem.id : null);
 * ```
 */
export function useListenerViewDrift(listenerKey: string | null): ListenerViewDrift {
  const baselineRef = useRef<Orientation | null>(null);
  const [hasDrifted, setHasDrifted] = useState(false);

  useEffect(() => {
    baselineRef.current = null;
    setHasDrifted(false);
    if (!listenerKey) return;

    const settleTimer = window.setTimeout(() => {
      const controller = useSpeckleEngineStore.getState().coordinator?.getCameraController();
      if (controller?.isFirstPersonMode()) baselineRef.current = controller.getListenerOrientation();
    }, FPS_CONTROLS_HINT.BASELINE_SETTLE_MS);

    const unsubscribe = useSpeckleEngineStore.subscribe((state, prev) => {
      const baseline = baselineRef.current;
      if (!baseline || state.currentCameraOrientation === prev.currentCameraOrientation) return;
      setHasDrifted(differs(state.currentCameraOrientation, baseline));
    });

    return () => {
      window.clearTimeout(settleTimer);
      unsubscribe();
    };
  }, [listenerKey]);

  const restore = useCallback(() => {
    const baseline = baselineRef.current;
    if (!baseline) return;
    useSpeckleEngineStore.getState().coordinator?.setFirstPersonRotation(baseline);
  }, []);

  return { hasDrifted, restore };
}
