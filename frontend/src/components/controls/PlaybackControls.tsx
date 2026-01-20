import { useEffect } from "react";
import { UI_COLORS, UI_OVERLAY, UI_VERTICAL_TABS, UI_RIGHT_SIDEBAR } from "@/lib/constants";

// Left sidebar content width when expanded (matches Sidebar.tsx: 20rem = 320px)
const LEFT_SIDEBAR_CONTENT_WIDTH = 320;
// Right sidebar collapsed width
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 40;

interface PlaybackControlsProps {
  onPlayAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
  isAnyPlaying: boolean;
  hasSounds: boolean;
  // Sidebar states for dynamic centering
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;
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
  hasSounds,
  isLeftSidebarExpanded = true,
  isRightSidebarExpanded = true
}: PlaybackControlsProps) {
  // Calculate left sidebar total width
  const leftSidebarWidth = UI_VERTICAL_TABS.WIDTH + (isLeftSidebarExpanded ? LEFT_SIDEBAR_CONTENT_WIDTH : 0);
  // Calculate right sidebar width
  const rightSidebarWidth = isRightSidebarExpanded ? UI_RIGHT_SIDEBAR.WIDTH : RIGHT_SIDEBAR_COLLAPSED_WIDTH;
  // Calculate center offset: positive = shift right, negative = shift left
  // Center should be in the middle of the visible area between the two sidebars
  const centerOffset = (leftSidebarWidth - rightSidebarWidth) / 2;
  // Space key toggles play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" && hasSounds) {
        e.preventDefault();
        if (isAnyPlaying) {
          onPauseAll();
        } else {
          onPlayAll();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSounds, isAnyPlaying, onPlayAll, onPauseAll]);

  // Don't show controls if there are no sounds
  if (!hasSounds) return null;

  // Button styles based on state
  const getButtonClass = (isEnabled: boolean) => {
    const baseClass = "px-4 py-1.5 rounded-md text-white font-medium text-sm transition-all duration-200";
    if (!isEnabled) {
      return `${baseClass} opacity-50 cursor-not-allowed`;
    }
    return `${baseClass} hover:opacity-90 active:scale-95`;
  };

  return (
    <div
      className="fixed bottom-6 pointer-events-auto z-50 transition-all duration-300"
      style={{ left: `calc(50% + ${centerOffset}px)`, transform: "translateX(-50%)" }}
    >
      <div 
        className="rounded-lg px-4 py-2 shadow-xl flex items-center gap-3"
        style={{
          backgroundColor: UI_OVERLAY.BACKGROUND,
          backdropFilter: 'blur(8px)',
          borderRadius: '8px',
          borderColor: `${UI_OVERLAY.BORDER_COLOR}`,
          borderWidth: '1px',
          borderStyle: 'solid'
        }}
      >
        {/* Play All Button */}
        <button
          onClick={isAnyPlaying ? undefined : onPlayAll}
          disabled={isAnyPlaying}
          className={getButtonClass(!isAnyPlaying)}
          style={{
            backgroundColor: !isAnyPlaying ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600,
            borderRadius: '8px'
          }}
          title={isAnyPlaying ? "Already playing" : "Play all sounds"}
        >
          ▶ Play All
        </button>

        {/* Pause All Button */}
        <button
          onClick={isAnyPlaying ? onPauseAll : undefined}
          disabled={!isAnyPlaying}
          className={getButtonClass(isAnyPlaying)}
          style={{
            backgroundColor: isAnyPlaying ? UI_COLORS.WARNING : UI_COLORS.NEUTRAL_600,
            borderRadius: '8px'
          }}
          title={isAnyPlaying ? "Pause all sounds" : "No sounds playing"}
        >
          ⏸ Pause All
        </button>

        {/* Stop All Button */}
        <button
          onClick={isAnyPlaying ? onStopAll : undefined}
          disabled={!isAnyPlaying}
          className={getButtonClass(isAnyPlaying)}
          style={{
            backgroundColor: isAnyPlaying ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600,
            borderRadius: '8px'
          }}
          title={isAnyPlaying ? "Stop all sounds" : "No sounds playing"}
        >
          ⏹ Stop All
        </button>
      </div>
    </div>
  );
}
