"use client";

import { NumberField } from "@/components/ui/NumberField";

export interface PositionWidgetProps {
  /** Current world position; missing axes default to 0. */
  position?: [number, number, number];
  /** Called with the full updated position when any axis changes. */
  onUpdatePosition: (pos: [number, number, number]) => void;
  /** When true, inputs are read-only (e.g. entity-linked sounds). */
  disabled?: boolean;
  /** Tooltip shown when disabled. */
  disabledTitle?: string;
  /** When true, recolors the inputs for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

/**
 * Shared x/y/z position editor used by sound cards and single-listener cards.
 *
 * Usage:
 * ```tsx
 * <PositionWidget
 *   position={sound.position}
 *   onUpdatePosition={(pos) => onUpdatePosition(sound.id, pos)}
 * />
 * ```
 */
export function PositionWidget({
  position,
  onUpdatePosition,
  disabled = false,
  disabledTitle,
  onBlueBackground = false,
}: PositionWidgetProps) {
  return (
    <div
      className="position-widget"
      title={disabled ? disabledTitle : undefined}
    >
      {(["x", "y", "z"] as const).map((axis, axisIdx) => {
        const val = position?.[axisIdx] ?? 0;
        return (
          <NumberField
            key={axis}
            prefix={axis}
            value={val}
            step={0.1}
            disabled={disabled}
            onBlueBackground={onBlueBackground}
            containerStyle={{ width: "55px", opacity: disabled ? 0.4 : 1 }}
            onChange={(n) => {
              const newPos: [number, number, number] = [
                position?.[0] ?? 0,
                position?.[1] ?? 0,
                position?.[2] ?? 0,
              ];
              newPos[axisIdx] = n;
              onUpdatePosition(newPos);
            }}
          />
        );
      })}
    </div>
  );
}
