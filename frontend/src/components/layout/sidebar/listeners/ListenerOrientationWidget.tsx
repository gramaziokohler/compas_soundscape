'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { ReceiverData } from '@/types/receiver';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { RefreshIcon } from '@/components/ui/Icon';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { LISTENER_ORIENTATION } from '@/utils/constants';

const ORIENTATION_AXES = ['Y', 'P', 'R'] as const;

interface Orientation {
  yaw: number;
  pitch: number;
  roll: number;
}

const toDeg = (rad: number) => (isNaN(rad) ? 0 : (rad * 180) / Math.PI);
const toRad = (deg: number) => (deg * Math.PI) / 180;
const formatDeg = (rad: number) => toDeg(rad).toFixed(LISTENER_ORIENTATION.PRECISION);

function sameOrientation(a: Orientation, b: Orientation): boolean {
  const eps = LISTENER_ORIENTATION.EPSILON_RAD;
  return Math.abs(a.yaw - b.yaw) <= eps && Math.abs(a.pitch - b.pitch) <= eps && Math.abs(a.roll - b.roll) <= eps;
}

function isFirstPersonActive(): boolean {
  return useSpeckleEngineStore.getState().coordinator?.isFirstPersonMode() ?? false;
}

interface ListenerOrientationWidgetProps {
  receiver: ReceiverData;
  color: string;
  /** True while this listener is powered (viewer in its locked FPS view). */
  isPowered: boolean;
}

/**
 * Editable yaw / pitch / roll (degrees) of a single listener.
 *
 * - Powered: shows the live FPS camera orientation; edits rotate the camera,
 *   and every change is autosaved (debounced) to the listener.
 * - Not powered: shows and edits the saved orientation directly.
 */
export function ListenerOrientationWidget({ receiver, color, isPowered }: ListenerOrientationWidgetProps) {
  const updateReceiverOrientation = useReceiversStore((s) => s.updateReceiverOrientation);
  const cameraOri = useSpeckleEngineStore((s) => s.currentCameraOrientation);

  const stored: Orientation = { yaw: receiver.yaw ?? 0, pitch: receiver.pitch ?? 0, roll: receiver.roll ?? 0 };
  const live: Orientation = { yaw: cameraOri.yaw, pitch: cameraOri.pitch, roll: cameraOri.roll };
  const shown = isPowered ? live : stored;
  const saved = receiver.orientationSaved ?? false;

  const isNonDefault =
    Math.abs(shown.yaw) > LISTENER_ORIENTATION.EPSILON_RAD ||
    Math.abs(shown.pitch) > LISTENER_ORIENTATION.EPSILON_RAD ||
    Math.abs(shown.roll) > LISTENER_ORIENTATION.EPSILON_RAD;

  // ── Live autosave while powered ─────────────────────────────────────────
  // Values are captured when the save is scheduled (only while the FPS view is
  // active), so the orbit-camera orientation restored after leaving FPS is
  // never written. A pending save is flushed on power-off / unmount.
  const pendingRef = useRef<Orientation | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiverId = receiver.id;

  const flushSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const current = useReceiversStore.getState().receivers.find((r) => r.id === receiverId);
    if (!current) return;
    const currentOri = { yaw: current.yaw ?? 0, pitch: current.pitch ?? 0, roll: current.roll ?? 0 };
    if (sameOrientation(currentOri, pending)) return;
    useReceiversStore.getState().updateReceiverOrientation(receiverId, pending.yaw, pending.pitch, pending.roll);
  }, [receiverId]);

  useEffect(() => {
    if (!isPowered || !isFirstPersonActive()) return;
    pendingRef.current = { yaw: live.yaw, pitch: live.pitch, roll: live.roll };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flushSave, LISTENER_ORIENTATION.SAVE_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.yaw, live.pitch, live.roll, isPowered, flushSave]);

  useEffect(() => {
    if (!isPowered) return;
    return flushSave;
  }, [isPowered, flushSave]);

  // ── Edits ───────────────────────────────────────────────────────────────
  const applyOrientation = useCallback((next: Orientation) => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (isPowered && coordinator?.isFirstPersonMode()) {
      // Rotate the FPS camera by the difference; the autosave persists it.
      coordinator.rotateFirstPersonView(next.yaw - live.yaw, next.pitch - live.pitch, next.roll - live.roll);
    } else {
      updateReceiverOrientation(receiverId, next.yaw, next.pitch, next.roll);
    }
  }, [isPowered, live.yaw, live.pitch, live.roll, receiverId, updateReceiverOrientation]);

  const handleUpdate = useCallback(([y, p, r]: [number, number, number]) => {
    applyOrientation({ yaw: toRad(y), pitch: toRad(p), roll: toRad(r) });
  }, [applyOrientation]);

  const handleReset = useCallback(() => {
    applyOrientation({ yaw: 0, pitch: 0, roll: 0 });
    // Clear the saved orientation right away (no debounce) when powered too.
    if (isPowered) {
      pendingRef.current = { yaw: 0, pitch: 0, roll: 0 };
      flushSave();
    }
  }, [applyOrientation, isPowered, flushSave]);

  return (
    <div className="card-stack--tight">
      <div className="flex items-end gap-1.5">
        <PositionWidget
          label="Orientation (°)"
          axisLabels={ORIENTATION_AXES}
          step={LISTENER_ORIENTATION.STEP_DEG}
          precision={LISTENER_ORIENTATION.PRECISION}
          position={[toDeg(shown.yaw), toDeg(shown.pitch), toDeg(shown.roll)]}
          onUpdatePosition={handleUpdate}
        />
        {isNonDefault && (
          <button
            onClick={handleReset}
            title="Reset orientation to default"
            className="w-5 h-5 mb-0.5 flex items-center justify-center rounded border text-[10px] transition-colors hover:opacity-80 shrink-0"
            style={{ borderColor: `${color}55`, color }}
          >
            <RefreshIcon size="0.625rem" />
          </button>
        )}
      </div>
      {isPowered && saved && (
        <span className="text-[9px]" style={{ color }}>
          Saved: Y: {formatDeg(stored.yaw)}&deg;&ensp;P: {formatDeg(stored.pitch)}&deg;&ensp;R: {formatDeg(stored.roll)}&deg;
        </span>
      )}
    </div>
  );
}
