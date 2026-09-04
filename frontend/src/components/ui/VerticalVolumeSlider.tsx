"use client";

import { useEffect, useRef, useState } from "react";
import { NumberField } from "./NumberField";
import { decimalsFromStep, estimateFieldWidthCh } from "./numberFieldSizing";

interface VerticalVolumeSliderProps {
  value: number;
  /** Defaults to 0. */
  min?: number;
  /** Defaults to 1. */
  max?: number;
  /** Defaults to 0.01. */
  step?: number;
  onChange: (value: number) => void;
  onChangeCommitted?: (value: number) => void; // Called when user releases the slider
  onDragStart?: () => void; // Called when user presses the slider
  className?: string;
  /** When true, recolors the track/fill/field for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
  /** Unit suffix rendered next to the editable value, in lighter/smaller text (e.g. "dBFS", "s"). */
  unit?: string;
  /** Decimal places shown/edited in the value field. Defaults to the decimal count of `step`. */
  precision?: number;
  /** Default value to reset to on double-click. If omitted, double-click reset is disabled. */
  defaultValue?: number;
  /** Caption rendered below the slider (e.g. "Vol.", "Int."). */
  label?: string;
  hoverText?: string;
  /**
   * When true, the slider stretches to fill the vertical space of its parent
   * flex column (the card body). The track grows/shrinks to match the height
   * of the sibling content column instead of using a fixed track height.
   */
  fillHeight?: boolean;
}

/**
 * VerticalVolumeSlider Component
 * 
 * Minimal vertical volume slider with an always-editable value field.
 * Shows filled track from bottom (min) to current value.
 * 
 * Features:
 * - Vertical orientation (bottom = min, top = max)
 * - Editable value field (NumberField) above the bar — number on the left, unit on the right
 * - Optional caption below the bar (e.g. "Vol.", "Int.")
 * - Filled track colored based on value (warning at 0, primary otherwise)
 * - Double-click on the slider to reset to a default value
 * - Uses same styling constants as horizontal RangeSlider
 * 
 * Usage:
 * ```tsx
 * <VerticalVolumeSlider
 *   value={globalVolume}
 *   onChange={setGlobalVolume}
 *   defaultValue={0.8}
 * />
 * ```
 */
export function VerticalVolumeSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onChangeCommitted,
  onDragStart,
  className = "",
  onBlueBackground = false,
  unit,
  precision,
  defaultValue,
  label,
  hoverText,
  fillHeight = false,
}: VerticalVolumeSliderProps) {
  const resolvedPrecision = precision ?? decimalsFromStep(step);

  // In fillHeight mode the track wrapper is a flex-1 row inside a stretched
  // column. Its resolved height is driven by the sibling content column, so we
  // measure it with a ResizeObserver and size the (rotated) native range input
  // + track visuals to that exact pixel height.
  const trackWrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredTrackHeight, setMeasuredTrackHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!fillHeight) {
      setMeasuredTrackHeight(null);
      return;
    }
    const el = trackWrapRef.current;
    if (!el) return;
    const measure = () => setMeasuredTrackHeight(el.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [fillHeight]);

  // Fixed 100px track unless filling the container height (RO updates shortly
  // after mount, so the first paint uses the legacy default — no visible jump).
  const trackLength = fillHeight ? (measuredTrackHeight ?? 100) : 100;

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handleChangeCommitted = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    if (onChangeCommitted) {
      const target = e.currentTarget as HTMLInputElement;
      onChangeCommitted(parseFloat(target.value));
    }
  };

  const handleDoubleClick = () => {
    if (defaultValue === undefined) return;
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

  // Calculate fill percentage from the real-world value range
  const fillPercentage = ((value - min) / (max - min)) * 100;

  // Determine color: muted (at min) uses secondary-hover (grey), otherwise primary
  // (or their on-blue equivalents when sitting directly on a solid-blue generated card)
  const isAtMin = value <= min;
  const fillColor = onBlueBackground
    ? (isAtMin ? 'var(--color-on-blue-muted)' : 'var(--color-on-blue)')
    : (isAtMin ? 'var(--color-secondary-hover)' : 'var(--color-primary)');

  const fieldWidthCh = estimateFieldWidthCh(min, max, resolvedPrecision, 0.5);

  return (
    <div
      className={`flex flex-col items-center ${fillHeight ? 'h-full min-w-0' : ''} ${className}`}
      title={hoverText}
    >
      {/* Editable value field — minimal width, unit compact below (not next to it) */}
      <div className="flex flex-col items-center mb-1">
        <NumberField
          value={value}
          precision={resolvedPrecision}
          onChange={handleFieldChange}
          onCommit={handleFieldCommit}
          onBlueBackground={onBlueBackground}
          containerStyle={{ width: `${fieldWidthCh}ch` }}
          className="!text-xs !py-0.5 !px-0.5"
        />
        {unit && (
          <span
            className="text-[9px] leading-none whitespace-nowrap mt-0.5"
            style={onBlueBackground ? { color: 'var(--color-on-blue-muted)' } : { color: 'var(--color-secondary-hover)' }}
          >
            {unit}
          </span>
        )}
      </div>

      <div
        ref={trackWrapRef}
        className="relative flex items-center justify-center"
        style={
          fillHeight
            ? { width: '24px', flex: '1 1 0%', minHeight: '28px' }
            : { width: '24px', height: '100px' }
        }
      >
        {/* Custom vertical track background (2px visual, surface-2) */}
        <div 
          className="absolute rounded-lg pointer-events-none"
          style={{
            width: '8px',
            height: `${trackLength}px`,
            backgroundColor: onBlueBackground ? 'var(--color-blue-chip-bg)' : 'var(--color-surface-2)',
            border: `1px solid ${onBlueBackground ? 'var(--color-on-blue-faint)' : 'var(--color-border)'}`,
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        >
          {/* Filled portion (from bottom) - unique to vertical slider */}
          <div 
            className="absolute bottom-0 rounded-lg transition-all duration-150 pointer-events-none"
            style={{
              width: '8px',
              height: `${fillPercentage}%`,
              backgroundColor: fillColor,
              left: 0
            }}
          />
        </div>

        {/* Actual input slider (rotated vertical) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          onMouseDown={() => onDragStart?.()}
          onTouchStart={() => onDragStart?.()}
          onMouseUp={handleChangeCommitted}
          onTouchEnd={handleChangeCommitted}
          onDoubleClick={handleDoubleClick}
          className="vertical-slider cursor-pointer absolute"
          title={defaultValue !== undefined ? `Double-click to reset (${defaultValue.toFixed(resolvedPrecision)}${unit ? ` ${unit}` : ''})` : undefined}
          style={{
            width: `${trackLength}px`,
            height: '24px',
            transform: 'rotate(-90deg)',
            transformOrigin: 'center center',
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'transparent',
            outline: 'none',
            margin: 0,
            padding: 0
          }}
        />

        {/* Slider thumb styling (11px blue thumb with surface ring) */}
        <style jsx>{`
          .vertical-slider::-webkit-slider-track {
            background: transparent;
            border: none;
            height: 24px;
          }
          
          .vertical-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: ${fillColor};
            cursor: pointer;
            border: 2px solid var(--color-surface);
            box-shadow: 0 0 0 1px ${fillColor};
            margin-top: 0;
          }
          
          .vertical-slider::-moz-range-track {
            background: transparent;
            border: none;
            height: 24px;
          }
          
          .vertical-slider::-moz-range-thumb {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: ${fillColor};
            cursor: pointer;
            border: 2px solid var(--color-surface);
            box-shadow: 0 0 0 1px ${fillColor};
          }

          .vertical-slider::-ms-track {
            background: transparent;
            border: none;
            height: 24px;
            color: transparent;
          }

          .vertical-slider::-ms-thumb {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: ${fillColor};
            cursor: pointer;
            border: 2px solid var(--color-surface);
            box-shadow: 0 0 0 1px ${fillColor};
          }

          .vertical-slider::-ms-fill-lower {
            background: transparent;
          }

          .vertical-slider::-ms-fill-upper {
            background: transparent;
          }
        `}</style>
      </div>

      {label && (
        <span
          className="text-[10px] mt-1 whitespace-nowrap"
          style={onBlueBackground ? { color: 'var(--color-on-blue-muted)' } : undefined}
        >
          {label}
        </span>
      )}
    </div>
  );
}
