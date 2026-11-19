'use client';

import { useEffect } from 'react';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { isShareViewActive } from '@/store/shareViewStore';
import { LISTENER_ORIENTATION } from '@/utils/constants';

export interface ListenerOrientation {
  yaw: number;
  pitch: number;
  roll: number;
}

function sameOrientation(a: ListenerOrientation, b: ListenerOrientation): boolean {
  const eps = LISTENER_ORIENTATION.EPSILON_RAD;
  return Math.abs(a.yaw - b.yaw) <= eps && Math.abs(a.pitch - b.pitch) <= eps && Math.abs(a.roll - b.roll) <= eps;
}

function isFirstPersonActive(): boolean {
  return useSpeckleEngineStore.getState().coordinator?.isFirstPersonMode() ?? false;
}

/**
 * Autosaves the FPS camera orientation and zoom (focal length) — debounced — to
 * the powered single listener.
 *
 * Mounted at page level so saving keeps working while the listener card is
 * reduced or the sidebar is hidden (the orientation widget is unmounted then).
 * Values are captured only while the FPS view is active, so the orbit-camera
 * orientation restored after leaving FPS is never written. A pending save is
 * flushed on power-off / unmount.
 *
 * Off in the share view: a visitor looking around never overwrites the
 * listener's saved orientation ("Back to listener view" returns to it).
 */
export function useListenerOrientationAutosave(poweredListenerId: string | null): void {
  useEffect(() => {
    if (!poweredListenerId || isShareViewActive()) return;
    const receiverId = poweredListenerId;
    let pending: (ListenerOrientation & { focalLength: number | null }) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const next = pending;
      pending = null;
      if (!next) return;
      const current = useReceiversStore.getState().receivers.find((r) => r.id === receiverId);
      if (!current) return;
      const currentOri = { yaw: current.yaw ?? 0, pitch: current.pitch ?? 0, roll: current.roll ?? 0 };
      const sameZoom = next.focalLength === null || next.focalLength === current.focalLength;
      if (sameOrientation(currentOri, next) && sameZoom) return;
      useReceiversStore.getState().updateReceiverOrientation(
        receiverId, next.yaw, next.pitch, next.roll, next.focalLength ?? undefined,
      );
    };

    const schedule = () => {
      if (!isFirstPersonActive()) return;
      const { currentCameraOrientation: ori, currentFpsFocalLength } = useSpeckleEngineStore.getState();
      pending = { yaw: ori.yaw, pitch: ori.pitch, roll: ori.roll, focalLength: currentFpsFocalLength };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, LISTENER_ORIENTATION.SAVE_DEBOUNCE_MS);
    };

    schedule();
    const unsubscribe = useSpeckleEngineStore.subscribe((state, prev) => {
      if (
        state.currentCameraOrientation !== prev.currentCameraOrientation ||
        state.currentFpsFocalLength !== prev.currentFpsFocalLength
      ) {
        schedule();
      }
    });

    return () => {
      unsubscribe();
      flush();
    };
  }, [poweredListenerId]);
}
