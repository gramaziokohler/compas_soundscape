"use client";

import type { IRFormat } from "@/types/audio";

interface AmbisonicModeNoticeProps {
  /** Current IR format being used */
  irFormat: IRFormat;
  /** Optional className for positioning */
  className?: string;
}

/**
 * AmbisonicModeNotice Component
 * 
 * Displays an informational notice when ambisonic IR is loaded.
 * Explains single-IR limitations and rotation vs. translation behavior.
 * 
 * Shows:
 * - IR format (FOA/TOA)
 * - Physical accuracy constraints
 * - What works (rotation) vs. what doesn't (translation)
 */
export function AmbisonicModeNotice({ irFormat, className = "" }: AmbisonicModeNoticeProps) {
  // Only show for ambisonic formats
  if (irFormat !== "foa" && irFormat !== "toa") {
    return null;
  }

  const formatName = irFormat === "foa" ? "1st Order Ambisonic (FOA)" : "3rd Order Ambisonic (TOA)";

  return (
    <div 
      className={`bg-sky-900/90 backdrop-blur-sm rounded-lg px-4 py-3 text-white text-sm border border-sky-500/50 shadow-lg max-w-md ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <svg 
          className="w-5 h-5 text-sky-400" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
          />
        </svg>
        <div className="font-semibold text-sky-300">
          Ambisonic Mode Active
        </div>
      </div>

      {/* IR Format */}
      <div className="mb-2 text-xs text-sky-200">
        Using <span className="font-mono font-bold">{formatName}</span> impulse response
      </div>

      {/* Constraints */}
      <div className="space-y-1 text-xs">
        <div className="flex items-start gap-2">
          <span className="text-green-400 mt-0.5">✓</span>
          <div>
            <span className="font-semibold">Head rotation works:</span> Sound sources stay fixed as you rotate
          </div>
        </div>
        
        <div className="flex items-start gap-2">
          <span className="text-yellow-400 mt-0.5">⚠</span>
          <div>
            <span className="font-semibold">Source positions fixed:</span> IR recorded from single location
          </div>
        </div>

        <div className="flex items-start gap-2">
          <span className="text-yellow-400 mt-0.5">⚠</span>
          <div>
            <span className="font-semibold">Listener position locked:</span> Movement would need different IR
          </div>
        </div>
      </div>

      {/* Help text */}
      <div className="mt-3 pt-2 border-t border-sky-500/30 text-xs text-sky-200">
        Enter first-person mode and use arrow keys to rotate your view
      </div>
    </div>
  );
}
