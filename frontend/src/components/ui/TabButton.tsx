"use client";

import { UI_COLORS, TAILWIND_TEXT_SIZE, TAILWIND_PADDING, TAILWIND_TRANSITION } from "@/lib/constants";

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * TabButton Component
 * 
 * Reusable tab button for navigation/switching between sections.
 * Used in Sidebar for Model/Sounds/Acoustics tabs.
 * 
 * Features:
 * - Active/inactive states with distinct styling
 * - Primary color when active, neutral when inactive
 * - Hover effects for inactive tabs
 * - Consistent padding and transitions
 * 
 * Usage:
 * ```tsx
 * <TabButton
 *   label="Model"
 *   isActive={activeTab === 'model'}
 *   onClick={() => setActiveTab('model')}
 * />
 * ```
 */
export function TabButton({ label, isActive, onClick, className = "" }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`${TAILWIND_PADDING.XL} py-2 font-medium ${TAILWIND_TRANSITION.COLORS} whitespace-nowrap ${TAILWIND_TEXT_SIZE.SM} ${className}`}
      style={{
        backgroundColor: isActive ? UI_COLORS.PRIMARY : "transparent",
        color: isActive ? "white" : UI_COLORS.NEUTRAL_600,
        borderRadius: "8px"
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
        }
      }}
    >
      {label}
    </button>
  );
}
