import { useMemo } from "react";

interface PlaybackControlsProps {
  onPlayAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
  isAnyPlaying: boolean;
  hasSounds: boolean;
}

/**
 * PlaybackControls Component
 *
 * Fixed horizontal controls at the bottom center of the 3D visible scene (excluding sidebar).
 * Features:
 * - Matches sound overlay styling (black/80 backdrop with rounded corners)
 * - Half height compared to original design
 * - Dynamic button colors (pink #F500B8, middle pink, grey) based on state
 * - Pause All and Stop All are only clickable when sounds are playing
 * - Rectangular shape with rounded corners
 */
export function PlaybackControls({
  onPlayAll,
  onPauseAll,
  onStopAll,
  isAnyPlaying,
  hasSounds
}: PlaybackControlsProps) {
  // Don't show controls if there are no sounds
  if (!hasSounds) return null;

  // Define colors matching the theme
  const PINK = "#F500B8";
  const MIDDLE_PINK = "#F57EC8"; // Lighter/middle shade of pink
  const GREY = "#9CA3AF"; // Tailwind gray-400

  // Button styles based on state
  const getButtonClass = (isEnabled: boolean) => {
    const baseClass = "px-4 py-1.5 rounded-md text-white font-medium text-sm transition-all duration-200";
    if (!isEnabled) {
      return `${baseClass} bg-gray-600 opacity-50 cursor-not-allowed`;
    }
    return `${baseClass} hover:opacity-90 active:scale-95`;
  };

  return (
    <div className="fixed bottom-6 pointer-events-auto z-50" style={{ left: "calc(50% + 192px)", transform: "translateX(-50%)" }}>
      <div className="bg-black/80 backdrop-blur-sm rounded-lg px-4 py-2 shadow-xl border border-white/20 flex items-center gap-3">
        {/* Play All Button */}
        <button
          onClick={isAnyPlaying ? undefined : onPlayAll}
          disabled={isAnyPlaying}
          className={getButtonClass(!isAnyPlaying)}
          style={!isAnyPlaying ? { backgroundColor: PINK } : undefined}
          title={isAnyPlaying ? "Already playing" : "Play all sounds"}
        >
          ▶ Play All
        </button>

        {/* Pause All Button */}
        <button
          onClick={isAnyPlaying ? onPauseAll : undefined}
          disabled={!isAnyPlaying}
          className={getButtonClass(isAnyPlaying)}
          style={isAnyPlaying ? { backgroundColor: MIDDLE_PINK } : undefined}
          title={isAnyPlaying ? "Pause all sounds" : "No sounds playing"}
        >
          ⏸ Pause All
        </button>

        {/* Stop All Button */}
        <button
          onClick={isAnyPlaying ? onStopAll : undefined}
          disabled={!isAnyPlaying}
          className={getButtonClass(isAnyPlaying)}
          style={isAnyPlaying ? { backgroundColor: PINK } : undefined}
          title={isAnyPlaying ? "Stop all sounds" : "No sounds playing"}
        >
          ⏹ Stop All
        </button>
      </div>
    </div>
  );
}
