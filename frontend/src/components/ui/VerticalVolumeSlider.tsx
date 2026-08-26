"use client";

interface VerticalVolumeSliderProps {
  value: number; // 0 to 1
  onChange: (value: number) => void;
  onChangeCommitted?: (value: number) => void; // Called when user releases the slider
  onDragStart?: () => void; // Called when user presses the slider
  className?: string;
  /** When true, recolors the track/fill for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

/**
 * VerticalVolumeSlider Component
 * 
 * Minimal vertical volume slider without label or box.
 * Shows filled track from bottom (0) to current value.
 * 
 * Features:
 * - Vertical orientation (bottom = 0, top = 1)
 * - Filled track colored based on volume (warning at 0, primary otherwise)
 * - No label, no title, no box - just the slider
 * - Uses same styling constants as horizontal RangeSlider
 * 
 * Styling matches RangeSlider:
 * - Track background: UI_COLORS.NEUTRAL_700
 * - Accent color: UI_COLORS.PRIMARY (or UI_COLORS.WARNING when muted)
 * - Track height: 8px (h-2 equivalent)
 * - Border radius: rounded-lg
 * 
 * Usage:
 * ```tsx
 * <VerticalVolumeSlider
 *   value={globalVolume}
 *   onChange={setGlobalVolume}
 * />
 * ```
 */
export function VerticalVolumeSlider({
  value,
  onChange,
  onChangeCommitted,
  onDragStart,
  className = "",
  onBlueBackground = false,
}: VerticalVolumeSliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handleChangeCommitted = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    if (onChangeCommitted) {
      const target = e.currentTarget as HTMLInputElement;
      onChangeCommitted(parseFloat(target.value));
    }
  };

  // Calculate fill percentage (inverted for vertical slider)
  const fillPercentage = value * 100;
  
  // Determine color: muted (0) uses secondary-hover (grey), otherwise primary
  // (or their on-blue equivalents when sitting directly on a solid-blue generated card)
  const fillColor = onBlueBackground
    ? (value === 0 ? 'var(--color-on-blue-muted)' : 'var(--color-on-blue)')
    : (value === 0 ? 'var(--color-secondary-hover)' : 'var(--color-primary)');

  return (
    <div 
      className={`relative flex items-center justify-center ${className}`}
      style={{
        width: '24px',
        height: '100px'
      }}
    >
      {/* Custom vertical track background (2px visual, surface-2) */}
      <div 
        className="absolute rounded-lg pointer-events-none"
        style={{
          width: '8px',
          height: '100px',
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
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={handleChange}
        onMouseDown={() => onDragStart?.()}
        onTouchStart={() => onDragStart?.()}
        onMouseUp={handleChangeCommitted}
        onTouchEnd={handleChangeCommitted}
        className="vertical-slider cursor-pointer absolute"
        style={{
          width: '100px',
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
  );
}
