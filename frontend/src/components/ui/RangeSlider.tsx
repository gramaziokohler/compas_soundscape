"use client";

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
  formatValue?: (value: number) => string;
  className?: string;
  showLabels?: boolean;
  hoverText?: string;
  disabled?: boolean;
  color?: string;
  /** Default value to reset to on double-click. If omitted, double-click reset is disabled. */
  defaultValue?: number;
}

/**
 * RangeSlider Component
 * * Reusable range slider with label, value display, and min/max labels.
 * Used in SoundUIOverlay and EntityUIOverlay for volume/interval controls.
 * * Features:
 * - Label with current value display
 * - Min/max labels below slider (defaults to numeric min/max if not provided)
 * - Custom value formatting (e.g., "Loop" for 0, dB suffix)
 * - Primary accent color
 * - Consistent styling
 * - Optional hover text tooltip
 * - Double-click on slider thumb to reset to default value
 * * Usage:
 * ```tsx
 * <RangeSlider
 * label="Volume (dB SPL)"
 * value={volume}
 * min={30}
 * max={120}
 * step={1}
 * onChange={setVolume}
 * formatValue={(v) => v.toFixed(0)}
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
  formatValue = (v) => v.toString(),
  className = "",
  showLabels = false,
  hoverText,
  disabled = false,
  color,
  defaultValue,
}: RangeSliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    if (onChangeCommitted) {
      onChangeCommitted(parseFloat((e.currentTarget as HTMLInputElement).value));
    }
  };

  const handleDoubleClick = () => {
    if (!disabled && defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };

  // Determine display labels: use provided prop, or fallback to the numeric value
  const displayMin = minLabel ?? min.toString();
  const displayMax = maxLabel ?? max.toString();

  return (
    <div 
      className={`${className}`} 
      title={hoverText} 
    >
      {/* Label and Value */}
      <div className={`flex items-center gap-1 text-xs text-secondary-hover`}>
        <span>{label}</span>
        <span className="text-xs font-bold" style={{ color: color? color : 'var(--card-color, var(--color-primary))' }}>
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
        onPointerDown={() => onDragStart?.()}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        disabled={disabled}
        className={`w-full h-2 rounded-lg appearance-none cursor-pointer bg-secondary-light-static ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={{ accentColor: color? color : 'var(--card-color, var(--color-primary))' }}
        title={defaultValue !== undefined ? `Double-click to reset (${formatValue(defaultValue)})` : hoverText}
      />

      {/* Min/Max Labels */}
      {showLabels && (
        <div className={`flex justify-between text-xs text-secondary-hover`}>
          <span>{displayMin}</span>
          <span>{displayMax}</span>
        </div>
      )}
    </div>
  );
}