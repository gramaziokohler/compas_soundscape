'use client';

import { useCallback } from 'react';
import type { ReceiverData } from '@/types/receiver';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { RefreshIcon } from '@/components/ui/Icon';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { LISTENER_ORIENTATION } from '@/utils/constants';
import type { ListenerOrientation as Orientation } from '@/hooks/useListenerOrientationAutosave';

const ORIENTATION_AXES = ['Y', 'P', 'R'] as const;

const toDeg = (rad: number) => (isNaN(rad) ? 0 : (rad * 180) / Math.PI);
const toRad = (deg: number) => (deg * Math.PI) / 180;
const formatDeg = (rad: number) => toDeg(rad).toFixed(LISTENER_ORIENTATION.PRECISION);

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
 *   and every change is autosaved (debounced) to the listener by
 *   `useListenerOrientationAutosave` (page level, so it also runs while this
 *   card is reduced).
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

  const receiverId = receiver.id;

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
    if (isPowered) updateReceiverOrientation(receiverId, 0, 0, 0);
  }, [applyOrientation, isPowered, receiverId, updateReceiverOrientation]);

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
