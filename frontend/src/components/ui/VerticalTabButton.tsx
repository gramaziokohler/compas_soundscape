"use client";

import { ReactNode } from "react";
import { UI_COLORS, UI_VERTICAL_TABS } from "@/utils/constants";

interface VerticalTabButtonProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  buttonColor?: string;
}   

/**
 * VerticalTabButton Component
 *
 * Reusable vertical tab button with icon and active state indicator.
 * Designed for sidebar navigation with left-aligned active indicator.
 *
 * @param icon - Icon element (SVG or component)
 * @param label - Accessible label for screen readers
 * @param isActive - Whether this tab is currently active
 * @param onClick - Click handler
 * @param buttonColor - Optional color for active state (defaults to primary)
 */
export function VerticalTabButton({ icon, label, buttonColor = UI_COLORS.PRIMARY, isActive, onClick }: VerticalTabButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative flex items-center justify-center w-full transition-all group"
      style={{
        height: `${UI_VERTICAL_TABS.HEIGHT}px`,
        color: isActive ? buttonColor : UI_COLORS.NEUTRAL_500
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = UI_COLORS.NEUTRAL_800;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = UI_COLORS.NEUTRAL_500;
        }
      }}
    >
      {/* Active indicator - vertical bar on the left */}
      {isActive && (
        <div
          className="absolute left-0 rounded-r"
          style={{
            backgroundColor: buttonColor,
            width: `${UI_VERTICAL_TABS.INDICATOR_WIDTH}px`,
            height: `${UI_VERTICAL_TABS.INDICATOR_HEIGHT}px`
          }}
        />
      )}

      {/* Icon container */}
      <div className="flex items-center justify-center">
        {icon}
      </div>
    </button>
  );
}
