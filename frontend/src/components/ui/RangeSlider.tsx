"use client";

import type { CSSProperties } from "react";
import { NumberField } from "./NumberField";
import { decimalsFromStep, estimateFieldWidthCh } from "./numberFieldSizing";

interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Called once on pointer-release with the final value. Provide this to get batched undo. */
  onChangeCommitted?: (value: number) => void;
  /** Called on pointer-down — use with useBatchedSlider to pause temporal recording. */
  onDragStart?: () => void;
  minLabel?: string;
  maxLabel?: string;
  /** Used to render the double-click-reset tooltip. Defaults to `${value}${unit ? ' ' + unit : ''}`. */
  formatValue?: (value: number) => string;
  /** Unit suffix rendered next to the editable value, in lighter/smaller text (e.g. "m", "dB", "s"). */
  unit?: string;
  /** Decimal places shown/edited in the value field. Defaults to the decimal count of `step`. */
  precision?: number;
  className?: string;
  showLabels?: boolean;
  hoverText?: string;
  disabled?: boolean;
  /** Fill/thumb accent color. Defaults to `var(--color-primary)`. */
  color?: string;
  /** Default value to reset to on double-click. If omitted, double-click reset is disabled. */
  defaultValue?: number;
}

/** Floor width for the slider track itself — below this it wraps to its own line instead of shrinking further. */
const MIN_SLIDER_WIDTH_PX = 60;

/**
 * RangeSlider Component
 * * Reusable range slider — label, an always-editable value field on the left of the
 * slider (same line), a filled track matching the vertical fader's look, and optional
 * min/max labels below. Used throughout the sidebar for volume/interval/simulation
 * parameter controls.
 * * Features:
 * - Label + editable value field (NumberField) + slider, all on one line —
 * number on the left, unit on the right (lighter/smaller text) of the value field
 * - Filled track (min → value colored, value → max muted), like VerticalVolumeSlider
 * - Min/max labels below slider (defaults to numeric min/max if not provided)
 * - Optional hover text tooltip
 * - Double-click on the slider to reset to a default value
 * * Usage:
 * ```tsx
 * <RangeSlider
 * label="Base Level"
 * value={volume}
 * min={-60}
 * max={0}
 * step={1}
 * unit="dBFS"
 * onChange={setVolume}
 * defaultValue={-18}
 * hoverText="Adjusts the master volume output" // Optional
 * />
 * ```
 */
export function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onChangeCommitted,
  onDragStart,
  minLabel,
  maxLabel,
  formatValue,
  unit,
  precision,
  className = "",
  showLabels = false,
  hoverText,
  disabled = false,
  color,
  defaultValue,
}: RangeSliderProps) {
  const resolvedPrecision = precision ?? decimalsFromStep(step);
  const resolvedFormatValue =
    formatValue ?? ((v: number) => (unit ? `${v.toFixed(resolvedPrecision)} ${unit}` : v.toFixed(resolvedPrecision)));

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    if (onChangeCommitted) {
      onChangeCommitted(parseFloat((e.currentTarget as HTMLInputElement).value));
    }
  };

  const handleDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    onChange(defaultValue);
    onChangeCommitted?.(defaultValue);
  };

  const handleFieldChange = (v: number) => {
    onChange(clamp(v));
  };

  const handleFieldCommit = (v: number | null) => {
    if (v === null) return;
    const clamped = clamp(v);
    onChange(clamped);
    onChangeCommitted?.(clamped);
  };

  const fieldWidthCh = estimateFieldWidthCh(min, max, resolvedPrecision);
  const fillPercent = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const sliderStyle = {
    "--slider-color": color ?? "var(--color-primary)",
    "--slider-fill": `${fillPercent}%`,
  } as CSSProperties;

  const valueField = (
    <span className="inline-flex items-baseline gap-1 shrink-0">
      <NumberField
        value={value}
        precision={resolvedPrecision}
        onChange={handleFieldChange}
        onCommit={handleFieldCommit}
        disabled={disabled}
        containerStyle={{ width: `${fieldWidthCh}ch` }}
        className="!text-xs !py-0.5"
      />
      {unit && <span className="text-[10px] text-secondary-hover whitespace-nowrap">{unit}</span>}
    </span>
  );

  // Determine display labels: use provided prop, or fallback to the numeric value
  const displayMin = minLabel ?? min.toString();
  const displayMax = maxLabel ?? max.toString();

  return (
    <div
      className={`${className}`}
      title={hoverText}
    >
      {/*
        Label + editable value (left) + slider, on one line when there's room.
        The value+slider group is its own flex item with a real min-content width
        (the slider has a floor of MIN_SLIDER_WIDTH_PX), so on narrow containers
        flex-wrap drops the whole group to a full-width second line instead of
        squashing the slider down to something undraggable.
      */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xxs text-secondary-hover whitespace-nowrap shrink-0">{label}</span>
        <div className="flex items-center gap-1 flex-1">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            onPointerDown={() => onDragStart?.()}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            disabled={disabled}
            className={`c-slider flex-1 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            style={{ ...sliderStyle, minWidth: `${MIN_SLIDER_WIDTH_PX}px` }}
            title={defaultValue !== undefined ? `Double-click to reset (${resolvedFormatValue(defaultValue)})` : hoverText}
          />
          {valueField}          
        </div>
      </div>

      {/* Min/Max Labels */}
      {showLabels && (
        <div className="flex justify-between text-xs text-secondary-hover mt-0.5">
          <span>{displayMin}</span>
          <span>{displayMax}</span>
        </div>
      )}
    </div>
  );
}
