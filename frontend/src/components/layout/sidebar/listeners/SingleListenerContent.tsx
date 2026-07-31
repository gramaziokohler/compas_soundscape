'use client';

import { useState, useRef, useCallback } from 'react';
import type { ReceiverData } from '@/types/receiver';
import { useReceiversStore } from '@/store/receiversStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

function toDeg(rad: number): string {
  if (isNaN(rad)) return '0.0';
  return ((rad * 180) / Math.PI).toFixed(1);
}

interface SingleListenerContentProps {
  receiver: ReceiverData;
  color: string;
  onUpdatePosition: (id: string, axis: 0 | 1 | 2, raw: string, currentPos: [number, number, number]) => void;
  listenerOrientation: { x: number; y: number; z: number };
}

export function SingleListenerContent({ receiver, color, onUpdatePosition }: SingleListenerContentProps) {
  const [x, y, z] = receiver.position;
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
    <div className="text-xs text-secondary-hover">
      <div className="font-medium mb-1.5" style={{ color }}>Position</div>
      <div className="flex gap-2">
        {(['x', 'y', 'z'] as const).map((axis, axisIdx) => {
          const val = [x, y, z][axisIdx];
          return (
            <div key={axis} className="flex-1 flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-secondary-hover uppercase">{axis}</span>
              <input
                type="number"
                step="0.1"
                value={parseFloat(val.toFixed(3))}
                onChange={(e) => onUpdatePosition(receiver.id, axisIdx as 0 | 1 | 2, e.target.value, receiver.position)}
                className="w-full text-[10px] font-mono rounded px-1.5 py-0.5 border outline-none focus:ring-1 bg-background text-foreground"
                style={{ borderColor: `${color}55` }}
              />
            </div>
          );
        })}
      </div>

      <div className="font-medium mb-1.5 mt-2.5" style={{ color }}>Orientation</div>
      <div className="flex flex-col gap-1 mb-2">
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
