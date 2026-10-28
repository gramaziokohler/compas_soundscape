'use client';

import { useCallback } from 'react';
import { RefreshIcon } from '@/components/ui/Icon';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { LISTENER_ORIENTATION } from '@/utils/constants';

/** Yaw / pitch / roll in radians (listener convention: yaw=0 faces -Y, +pitch up). */
export interface OrientationValue {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface OrientationWidgetProps {
  value: OrientationValue;
  /** Called with the full orientation (radians) when any angle changes. */
  onChange: (next: OrientationValue) => void;
  /** Reset handler; the reset button shows only while the orientation is non-default. */
  onReset?: () => void;
  label?: string;
  /** Colour of the reset button (defaults to the primary token). */
  accentColor?: string;
  disabled?: boolean;
  disabledTitle?: string;
  onBlueBackground?: boolean;
}

const ORIENTATION_AXES = ['Y', 'P', 'R'] as const;
const toDeg = (rad: number) => (isNaN(rad) ? 0 : (rad * 180) / Math.PI);
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** True when any angle is beyond the display epsilon. */
export function isNonDefaultOrientation(o: OrientationValue): boolean {
  return (
    Math.abs(o.yaw) > LISTENER_ORIENTATION.EPSILON_RAD ||
    Math.abs(o.pitch) > LISTENER_ORIENTATION.EPSILON_RAD ||
    Math.abs(o.roll) > LISTENER_ORIENTATION.EPSILON_RAD
  );
}

/**
 * Editable yaw / pitch / roll (degrees in the inputs, radians in the value) with
 * an optional reset button — the listener and sound-source orientation editor.
 *
 * Usage:
 * ```tsx
 * <OrientationWidget value={{ yaw, pitch, roll }} onChange={setOrientation} onReset={() => setOrientation(ZERO)} />
 * ```
 */
export function OrientationWidget({
  value,
  onChange,
  onReset,
  label = 'Orientation (°)',
  accentColor = 'var(--color-primary)',
  disabled = false,
  disabledTitle,
  onBlueBackground = false,
}: OrientationWidgetProps) {
  const handleUpdate = useCallback(
    ([y, p, r]: [number, number, number]) => onChange({ yaw: toRad(y), pitch: toRad(p), roll: toRad(r) }),
    [onChange],
  );

  return (
    <div className="flex items-end gap-1.5">
      <PositionWidget
        label={label}
        axisLabels={ORIENTATION_AXES}
        step={LISTENER_ORIENTATION.STEP_DEG}
        precision={LISTENER_ORIENTATION.PRECISION}
        position={[toDeg(value.yaw), toDeg(value.pitch), toDeg(value.roll)]}
        onUpdatePosition={handleUpdate}
        disabled={disabled}
        disabledTitle={disabledTitle}
        onBlueBackground={onBlueBackground}
      />
      {onReset && isNonDefaultOrientation(value) && (
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          title="Reset orientation to default"
          className="w-5 h-5 mb-0.5 flex items-center justify-center rounded border text-[10px] transition-colors hover:opacity-80 shrink-0"
          style={{ borderColor: `color-mix(in srgb, ${accentColor} 35%, transparent)`, color: accentColor }}
        >
          <RefreshIcon size="0.625rem" />
        </button>
      )}
    </div>
  );
}
