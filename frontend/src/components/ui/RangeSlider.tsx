"use client";

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
  className?: string;
  showLabels?: boolean;
  hoverText?: string;
  disabled?: boolean;
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
  minLabel,
  maxLabel,
  formatValue = (v) => v.toString(),
  className = "",
  showLabels = true,
  hoverText,
  disabled = false,
}: RangeSliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
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
        <span className="text-xs font-bold" style={{ color: 'var(--card-color, var(--color-primary))' }}>
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
        disabled={disabled}
        className={`w-full h-2 rounded-lg appearance-none cursor-pointer bg-secondary-light ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={{ accentColor: 'var(--card-color, var(--color-primary))' }}
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