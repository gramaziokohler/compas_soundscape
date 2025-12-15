"use client";

import { useMemo } from "react";
import { UI_COLORS, UI_OVERLAY } from "@/lib/constants";

interface OrientationIndicatorProps {
  /** Yaw angle in radians (horizontal rotation) */
  yaw: number;
  /** Pitch angle in radians (vertical rotation) */
  pitch: number;
  /** Optional className for positioning */
  className?: string;
  /** Callback to exit first-person mode */
  onExitFirstPersonMode?: () => void;
}

/**
 * OrientationIndicator Component
 * 
 * Displays current listener orientation in first-person mode.
 * Shows compass direction (N/S/E/W) and pitch angle (up/down).
 * 
 * Usage:
 * - Positioned in top-left corner during first-person mode
 * - Updates in real-time as user rotates with arrow keys
 * - Provides spatial awareness feedback
 */
export function OrientationIndicator({ yaw, pitch, className = "", onExitFirstPersonMode }: OrientationIndicatorProps) {
  // Convert radians to degrees
  const yawDeg = useMemo(() => {
    // Three.js: 0 = +Z axis (North), rotates CCW
    // Convert to compass bearing (0-360°, 0 = North, clockwise)
    let deg = (-yaw * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    return deg;
  }, [yaw]);

  const pitchDeg = useMemo(() => {
    return pitch * 180 / Math.PI;
  }, [pitch]);

  // Get compass direction
  const compassDirection = useMemo(() => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(yawDeg / 45) % 8;
    return directions[index];
  }, [yawDeg]);

  // Get pitch description
  const pitchDescription = useMemo(() => {
    if (pitchDeg > 30) return "Up";
    if (pitchDeg < -30) return "Down";
    return "Level";
  }, [pitchDeg]);

  return (
    <div 
      className={`rounded-lg px-4 py-3 text-white font-mono text-sm ${className}`}
      style={{
        backgroundColor: UI_OVERLAY.BACKGROUND,
        backdropFilter: 'blur(8px)',
        borderRadius: '8px',
        borderColor: `${UI_OVERLAY.BORDER_COLOR}`,
        borderWidth: '1px',
        borderStyle: 'solid'
      }}
    >
      <div className="flex items-center gap-4">
        {/* Compass */}
        <div className="flex flex-col items-center">
          <div className="text-xs mb-1" style={{ color: UI_COLORS.NEUTRAL_400 }}>Heading</div>
          <div className="flex items-center gap-2">
            {/* Compass Rose */}
            <div 
              className="relative w-12 h-12 rounded-full"
              style={{
                backgroundColor: UI_COLORS.NEUTRAL_900,
                borderColor: `${UI_COLORS.PRIMARY}80`,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '9999px'
              }}
            >
              {/* North marker */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-2" style={{ backgroundColor: UI_COLORS.PRIMARY }} />
              
              {/* Direction indicator (rotates) */}
              <div 
                className="absolute inset-0 flex items-start justify-center transition-transform duration-100"
                style={{ transform: `rotate(${yawDeg}deg)` }}
              >
                <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[8px] border-l-transparent border-r-transparent mt-1" style={{ borderBottomColor: 'white' }} />
              </div>
            </div>
            
            {/* Direction text */}
            <div className="flex flex-col">
              <div className="text-xl font-bold" style={{ color: UI_COLORS.PRIMARY }}>{compassDirection}</div>
              <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>{yawDeg.toFixed(0)}°</div>
            </div>
          </div>
        </div>

        {/* Separator */}
        <div className="w-px h-12" style={{ backgroundColor: `${UI_OVERLAY.BORDER_COLOR}` }} />

        {/* Pitch */}
        <div className="flex flex-col items-center">
          <div className="text-xs mb-1" style={{ color: UI_COLORS.NEUTRAL_400 }}>Pitch</div>
          <div className="flex items-center gap-2">
            {/* Pitch indicator */}
            <div 
              className="relative w-8 h-12 rounded overflow-hidden"
              style={{
                backgroundColor: UI_COLORS.NEUTRAL_900,
                borderColor: `${UI_COLORS.PRIMARY}80`,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '8px'
              }}
            >
              {/* Center line */}
              <div className="absolute top-1/2 left-0 right-0 h-px" style={{ backgroundColor: `${UI_COLORS.PRIMARY}80` }} />
              
              {/* Pitch marker */}
              <div 
                className="absolute left-1/2 -translate-x-1/2 w-4 h-1 transition-all duration-100"
                style={{ 
                  top: `${50 - (pitchDeg / 90 * 40)}%`,
                  backgroundColor: 'white'
                }}
              />
            </div>
            
            {/* Pitch text */}
            <div className="flex flex-col">
              <div className="text-lg font-bold" style={{ color: UI_COLORS.PRIMARY }}>{pitchDescription}</div>
              <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>{pitchDeg.toFixed(0)}°</div>
            </div>
          </div>
        </div>
      </div>

      {/* Help text and Exit button */}
      <div className="mt-2 pt-2 flex items-center justify-between gap-4" style={{ borderTopColor: `${UI_OVERLAY.BORDER_COLOR}`, borderTopWidth: '1px', borderTopStyle: 'solid' }}>
        <div className="text-xs text-center flex-1" style={{ color: UI_COLORS.NEUTRAL_400 }}>
          Use arrow keys for Head rotation
          <br />
          (Translation locked)
        </div>

        {/* Exit First-Person Mode button */}
        {onExitFirstPersonMode && (
          <button
            onClick={onExitFirstPersonMode}
            className="px-3 py-1.5 rounded text-xs font-semibold transition-colors"
            style={{
              backgroundColor: UI_COLORS.ERROR,
              color: 'white',
              borderRadius: '6px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = UI_COLORS.ERROR;
            }}
            title="Exit first-person mode (ESC)"
          >
            Exit
          </button>
        )}
      </div>
    </div>
  );
}
