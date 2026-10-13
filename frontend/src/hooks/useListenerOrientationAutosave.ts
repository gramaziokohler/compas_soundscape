'use client';

import { useEffect } from 'react';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
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
 * Autosaves the FPS camera orientation (debounced) to the powered single listener.
 *
 * Mounted at page level so saving keeps working while the listener card is
 * reduced or the sidebar is hidden (the orientation widget is unmounted then).
 * Values are captured only while the FPS view is active, so the orbit-camera
 * orientation restored after leaving FPS is never written. A pending save is
 * flushed on power-off / unmount.
 */
export function useListenerOrientationAutosave(poweredListenerId: string | null): void {
  useEffect(() => {
    if (!poweredListenerId) return;
    const receiverId = poweredListenerId;
    let pending: ListenerOrientation | null = null;
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
      if (sameOrientation(currentOri, next)) return;
      useReceiversStore.getState().updateReceiverOrientation(receiverId, next.yaw, next.pitch, next.roll);
    };

    const schedule = (ori: ListenerOrientation) => {
      if (!isFirstPersonActive()) return;
      pending = { yaw: ori.yaw, pitch: ori.pitch, roll: ori.roll };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, LISTENER_ORIENTATION.SAVE_DEBOUNCE_MS);
    };

    schedule(useSpeckleEngineStore.getState().currentCameraOrientation);
    const unsubscribe = useSpeckleEngineStore.subscribe((state, prev) => {
      if (state.currentCameraOrientation !== prev.currentCameraOrientation) {
        schedule(state.currentCameraOrientation);
      }
    });

    return () => {
      unsubscribe();
      flush();
    };
  }, [poweredListenerId]);
}
