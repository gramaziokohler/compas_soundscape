'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { ReceiverData } from '@/types/receiver';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { RefreshIcon } from '@/components/ui/Icon';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { Notice } from '@/components/ui/Notice';

/** Radians below which two orientations are considered equal. */
const ORIENTATION_EPSILON = 1e-4;

function toDeg(rad: number): string {
  if (isNaN(rad)) return '0.0';
  return ((rad * 180) / Math.PI).toFixed(1);
}

interface SingleListenerContentProps {
  receiver: ReceiverData;
  color: string;
  onUpdatePosition: (id: string, position: [number, number, number]) => void;
  listenerOrientation: { x: number; y: number; z: number };
}

export function SingleListenerContent({ receiver, color, onUpdatePosition }: SingleListenerContentProps) {
  const updateReceiverOrientation = useReceiversStore((s) => s.updateReceiverOrientation);
  const cameraOri = useSpeckleEngineStore((s) => s.currentCameraOrientation);

  const storedYaw = receiver.yaw ?? 0;
  const storedPitch = receiver.pitch ?? 0;
  const storedRoll = receiver.roll ?? 0;
  const saved = receiver.orientationSaved ?? false;

  const liveYaw = cameraOri.yaw;
  const livePitch = cameraOri.pitch;
  const liveRoll = cameraOri.roll;

  const hasNonDefaultOrientation =
    Math.abs(liveYaw) > ORIENTATION_EPSILON ||
    Math.abs(livePitch) > ORIENTATION_EPSILON ||
    Math.abs(liveRoll) > ORIENTATION_EPSILON;

  // Last camera orientation seen while the FPS view was active. Captured only in
  // FPS mode so the orientation reset that follows leaving FPS never overwrites it.
  const lastFpsOrientationRef = useRef<{ yaw: number; pitch: number; roll: number } | null>(null);

  useEffect(() => {
    if (useSpeckleEngineStore.getState().coordinator?.isFirstPersonMode()) {
      lastFpsOrientationRef.current = { yaw: liveYaw, pitch: livePitch, roll: liveRoll };
    }
  }, [liveYaw, livePitch, liveRoll]);

  // Auto-save on unmount: every way of leaving FPS (reducing the card, Esc,
  // double-click, collapse-all) collapses the card and unmounts this content.
  useEffect(() => {
    const receiverId = receiver.id;
    return () => {
      const last = lastFpsOrientationRef.current;
      if (!last) return;
      const stored = useReceiversStore.getState().receivers.find((r) => r.id === receiverId);
      if (!stored) return;
      const unchanged =
        Math.abs((stored.yaw ?? 0) - last.yaw) <= ORIENTATION_EPSILON &&
        Math.abs((stored.pitch ?? 0) - last.pitch) <= ORIENTATION_EPSILON &&
        Math.abs((stored.roll ?? 0) - last.roll) <= ORIENTATION_EPSILON;
      if (unchanged) return;
      useReceiversStore.getState().updateReceiverOrientation(receiverId, last.yaw, last.pitch, last.roll);
    };
  }, [receiver.id]);

  const handleResetOrientation = useCallback(() => {
    // Clear any saved orientation for this receiver
    updateReceiverOrientation(receiver.id, 0, 0, 0);
    lastFpsOrientationRef.current = { yaw: 0, pitch: 0, roll: 0 };

    // Rotate the camera back to the default orientation (yaw/pitch/roll = 0)
    const { coordinator } = useSpeckleEngineStore.getState();
    if (coordinator?.isFirstPersonMode()) {
      coordinator.rotateFirstPersonView(-liveYaw, -livePitch, -liveRoll);
    }
  }, [liveYaw, livePitch, liveRoll, receiver.id, updateReceiverOrientation]);

  return (
    <div className="card-stack text-xs text-secondary-hover">
      <div>
        <Notice
          type="warning"
          message="Viewer in locked FPS viewmode. Press Esc or reduce this card to cancel it."
        />
      </div>
      <PositionWidget
        position={receiver.position}
        onUpdatePosition={(pos) => onUpdatePosition(receiver.id, pos)}
      />

      <div className="font-medium card-label" style={{ color }}>Orientation</div>
      <div className="card-stack--tight">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-secondary-hover">
            Y: {toDeg(liveYaw)}&deg;&ensp;P: {toDeg(livePitch)}&deg;&ensp;R: {toDeg(liveRoll)}&deg;
          </span>
          {hasNonDefaultOrientation && (
            <button
              onClick={handleResetOrientation}
              title="Reset orientation to default"
              className="w-5 h-5 flex items-center justify-center rounded border text-[10px] transition-colors hover:opacity-80 shrink-0"
              style={{ borderColor: `${color}55`, color }}
            >
              <RefreshIcon size="0.625rem" />
            </button>
          )}
        </div>
        {saved && (
          <span className="text-[9px]" style={{ color }}>
            Saved: Y: {toDeg(storedYaw)}&deg;&ensp;P: {toDeg(storedPitch)}&deg;&ensp;R: {toDeg(storedRoll)}&deg;
          </span>
        )}
      </div>
    </div>
  );
}
