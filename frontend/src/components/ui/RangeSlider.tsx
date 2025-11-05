"use client";

import { UI_COLORS, TAILWIND_TEXT_SIZE } from "@/lib/constants";

interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  minLabel?: string;
  maxLabel?: string;
  formatValue?: (value: number) => string;
  valueColor?: string;
  className?: string;
}

/**
 * RangeSlider Component
 * 
 * Reusable range slider with label, value display, and min/max labels.
 * Used in SoundUIOverlay and EntityUIOverlay for volume/interval controls.
 * 
 * Features:
 * - Label with current value display
 * - Min/max labels below slider
 * - Custom value formatting (e.g., "Loop" for 0, dB suffix)
 * - Primary accent color
 * - Consistent styling
 * 
 * Usage:
 * ```tsx
 * <RangeSlider
 *   label="Volume (dB SPL)"
 *   value={volume}
 *   min={30}
 *   max={120}
 *   step={1}
 *   onChange={setVolume}
 *   minLabel="30"
 *   maxLabel="120"
 *   formatValue={(v) => v.toFixed(0)}
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
  minLabel,
  maxLabel,
  formatValue = (v) => v.toString(),
  valueColor = UI_COLORS.PRIMARY,
  className = ""
}: RangeSliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  return (
    <div className={`${className}`}>
      {/* Label and Value */}
      <div className={`flex items-center justify-between ${TAILWIND_TEXT_SIZE.XS} text-gray-300 mb-1`}>
        <span>{label}</span>
        <span className="font-mono" style={{ color: valueColor }}>
          {formatValue(value)}
        </span>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
        style={{ backgroundColor: UI_COLORS.NEUTRAL_700 }}
      />

      {/* Min/Max Labels */}
      {(minLabel || maxLabel) && (
        <div className={`flex justify-between ${TAILWIND_TEXT_SIZE.XS} text-gray-400 mt-1`}>
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
