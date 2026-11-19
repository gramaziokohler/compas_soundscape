'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { FPS_CONTROLS_HINT } from '@/utils/constants';

type Orientation = { yaw: number; pitch: number; roll: number };
/** A listener view: look direction + zoom (focal length, mm; null if unknown). */
type View = Orientation & { focalLength: number | null };

function differs(a: View, b: View): boolean {
  const t = FPS_CONTROLS_HINT.DRIFT_THRESHOLD_RAD;
  const zoomed = a.focalLength !== null && b.focalLength !== null
    && Math.abs(a.focalLength - b.focalLength) > FPS_CONTROLS_HINT.DRIFT_THRESHOLD_FOCAL_MM;
  return zoomed || Math.abs(a.yaw - b.yaw) > t || Math.abs(a.pitch - b.pitch) > t || Math.abs(a.roll - b.roll) > t;
}

export interface ListenerViewDrift {
  /** The visitor turned the first-person view away from the listener's saved orientation. */
  hasDrifted: boolean;
  /** Turn the first-person view back to the listener's saved orientation. */
  restore: () => void;
}

/**
 * Tracks whether the first-person view was turned or zoomed away from the view
 * the listener was entered with (its saved yaw/pitch/roll and zoom, or the
 * defaults), and returns to it on demand.
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
  const baselineRef = useRef<View | null>(null);
  const [hasDrifted, setHasDrifted] = useState(false);

  useEffect(() => {
    baselineRef.current = null;
    setHasDrifted(false);
    if (!listenerKey) return;

    const settleTimer = window.setTimeout(() => {
      const controller = useSpeckleEngineStore.getState().coordinator?.getCameraController();
      if (controller?.isFirstPersonMode()) {
        baselineRef.current = { ...controller.getListenerOrientation(), focalLength: controller.getFirstPersonFocalLength() };
      }
    }, FPS_CONTROLS_HINT.BASELINE_SETTLE_MS);

    const unsubscribe = useSpeckleEngineStore.subscribe((state, prev) => {
      const baseline = baselineRef.current;
      if (
        !baseline ||
        (state.currentCameraOrientation === prev.currentCameraOrientation &&
          state.currentFpsFocalLength === prev.currentFpsFocalLength)
      ) return;
      setHasDrifted(differs({ ...state.currentCameraOrientation, focalLength: state.currentFpsFocalLength }, baseline));
    });

    return () => {
      window.clearTimeout(settleTimer);
      unsubscribe();
    };
  }, [listenerKey]);

  const restore = useCallback(() => {
    const baseline = baselineRef.current;
    if (!baseline) return;
    const { coordinator } = useSpeckleEngineStore.getState();
    coordinator?.setFirstPersonRotation(baseline);
    if (baseline.focalLength !== null) coordinator?.setFirstPersonFocalLength(baseline.focalLength);
  }, []);

  return { hasDrifted, restore };
}
