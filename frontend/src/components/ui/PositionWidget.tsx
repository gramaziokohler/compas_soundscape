"use client";

import { NumberField } from "@/components/ui/NumberField";
import { estimatePrefixedNumberFieldWidth } from "@/components/ui/numberFieldSizing";

/** Matches NumberField's own default display precision. */
const POSITION_PRECISION = 2;

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
      className="flex flex-col"
      title={disabled ? disabledTitle : undefined}
    >
      <span
        className={`text-[10px] mb-1 ${onBlueBackground ? "" : "text-secondary-hover"}`}
        style={onBlueBackground ? { color: "var(--color-on-blue-muted)" } : undefined}
      >
        Position
      </span>
      <div className="position-widget">
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
            precision={POSITION_PRECISION}
            containerStyle={{
              width: estimatePrefixedNumberFieldWidth(val, POSITION_PRECISION),
              opacity: disabled ? 0.4 : 1,
              // `ch` on the wrapper must match the mono input font so width tracks digits.
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
            }}
            className="!text-xs !py-0.5"
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
    </div>
  );
}
