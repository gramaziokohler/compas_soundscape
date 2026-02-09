import { useEffect } from "react";
import { UI_COLORS, UI_OVERLAY, UI_VERTICAL_TABS, UI_RIGHT_SIDEBAR } from "@/utils/constants";

const LEFT_SIDEBAR_CONTENT_WIDTH = 240;
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 30;

interface PlaybackControlsProps {
  onPlayAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
  isAnyPlaying: boolean;
  hasSounds: boolean;
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;
}

export function PlaybackControls({
  onPlayAll,
  onPauseAll,
  onStopAll,
  isAnyPlaying,
  hasSounds,
  isLeftSidebarExpanded = true,
  isRightSidebarExpanded = true
}: PlaybackControlsProps) {
  const leftSidebarWidth = (UI_VERTICAL_TABS.WIDTH * 0.75) + (isLeftSidebarExpanded ? LEFT_SIDEBAR_CONTENT_WIDTH : 0);
  const rightSidebarWidth = isRightSidebarExpanded ? (UI_RIGHT_SIDEBAR.WIDTH * 0.75) : RIGHT_SIDEBAR_COLLAPSED_WIDTH;
  const centerOffset = (leftSidebarWidth - rightSidebarWidth) / 2;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" && hasSounds) {
        e.preventDefault();
        isAnyPlaying ? onPauseAll() : onPlayAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSounds, isAnyPlaying, onPlayAll, onPauseAll]);

  if (!hasSounds) return null;

  const getButtonClass = (isEnabled: boolean) => {
    const baseClass = "px-3 py-1.5 rounded-md text-white font-medium text-xs transition-all duration-200";
    return isEnabled ? `${baseClass} hover:opacity-80 active:scale-95` : `${baseClass} opacity-50 cursor-not-allowed`;
  };

  return (
    <div
      className="fixed bottom-4.5 pointer-events-auto z-50 transition-all duration-300"
      style={{ left: `calc(50% + ${centerOffset}px)`, transform: "translateX(-50%)" }}
    >
      <div 
        className="rounded-md px-3 py-1.5 flex items-center gap-2.25"
      >
        <button
          onClick={isAnyPlaying ? undefined : onPlayAll}
          disabled={isAnyPlaying}
          className={getButtonClass(!isAnyPlaying)}
          style={{
            backgroundColor: !isAnyPlaying ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600,
            borderRadius: '6px'
          }}
        >
          ▶ Play All
        </button>

        <button
          onClick={isAnyPlaying ? onPauseAll : undefined}
          disabled={!isAnyPlaying}
          className={getButtonClass(isAnyPlaying)}
          style={{
            backgroundColor: isAnyPlaying ? UI_COLORS.WARNING : UI_COLORS.NEUTRAL_600,
            borderRadius: '6px'
          }}
        >
          ⏸ Pause All
        </button>

        <button
          onClick={isAnyPlaying ? onStopAll : undefined}
          disabled={!isAnyPlaying}
          className={getButtonClass(isAnyPlaying)}
          style={{
            backgroundColor: isAnyPlaying ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600,
            borderRadius: '6px'
          }}
        >
          ⏹ Stop All
        </button>
      </div>
    </div>
  );
}