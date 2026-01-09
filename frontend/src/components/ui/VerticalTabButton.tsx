"use client";

import { ReactNode } from "react";
import { UI_COLORS, UI_VERTICAL_TABS } from "@/lib/constants";

interface VerticalTabButtonProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
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
 */
export function VerticalTabButton({ icon, label, isActive, onClick }: VerticalTabButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative flex items-center justify-center w-full transition-all group"
      style={{
        height: `${UI_VERTICAL_TABS.HEIGHT}px`,
        color: isActive ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_500
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
            backgroundColor: UI_COLORS.PRIMARY,
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
