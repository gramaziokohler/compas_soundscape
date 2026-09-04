'use client';

import { useState, useRef, useCallback } from 'react';
import type { ReceiverData } from '@/types/receiver';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { RefreshIcon } from '@/components/ui/Icon';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { Notice } from '@/components/ui/Notice';

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
  const orientationSaved = receiver.orientationSaved ?? false;

  const [saved, setSaved] = useState(orientationSaved);
  const savedRef = useRef(orientationSaved);

  const liveYaw = cameraOri.yaw;
  const livePitch = cameraOri.pitch;
  const liveRoll = cameraOri.roll;

  const hasNonDefaultOrientation =
    Math.abs(liveYaw) > 1e-4 || Math.abs(livePitch) > 1e-4 || Math.abs(liveRoll) > 1e-4;

  const handleResetOrientation = useCallback(() => {
    // Clear any saved orientation for this receiver
    updateReceiverOrientation(receiver.id, 0, 0, 0);
    savedRef.current = false;
    setSaved(false);

    // Rotate the camera back to the default orientation (yaw/pitch/roll = 0)
    const { coordinator } = useSpeckleEngineStore.getState();
    if (coordinator?.isFirstPersonMode()) {
      coordinator.rotateFirstPersonView(-liveYaw, -livePitch, -liveRoll);
    }
  }, [liveYaw, livePitch, liveRoll, receiver.id, updateReceiverOrientation]);

  const handleOrientationClick = useCallback(() => {
    if (savedRef.current) {
      // Reset to default orientation
      updateReceiverOrientation(receiver.id, 0, 0, 0);
      savedRef.current = false;
      setSaved(false);
      // Rotate camera to default direction
      const { coordinator } = useSpeckleEngineStore.getState();
      coordinator?.rotateFirstPersonView(-liveYaw, -livePitch, -liveRoll);
    } else {
      // Save current live orientation
      updateReceiverOrientation(receiver.id, liveYaw, livePitch, liveRoll);
      savedRef.current = true;
      setSaved(true);
    }
  }, [liveYaw, livePitch, liveRoll, receiver.id, updateReceiverOrientation]);

  return (
    <div className="card-stack text-xs text-secondary-hover">
      <div>
        <Notice
          type="info"
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
          <button
            onClick={handleOrientationClick}
            title={saved ? 'Reset to default orientation' : 'Save current listener orientation'}
            className="w-5 h-5 flex items-center justify-center rounded border text-[10px] transition-colors hover:opacity-80 shrink-0"
            style={{ borderColor: `${color}55`, color }}
          >
            {saved ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </button>
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
