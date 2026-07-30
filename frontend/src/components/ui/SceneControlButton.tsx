"use client";

import { ReactNode } from "react";
import { UI_SCENE_BUTTON } from "@/utils/constants";

interface SceneControlButtonProps {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  isActive?: boolean;
  activeColor?: string;
  inactiveBackground?: string;
  border?: boolean
  background?: boolean
}

/**
 * SceneControlButton Component
 * 
 * Reusable button for 3D scene controls (bottom-right corner).
 * 
 * Features:
 * - Consistent styling with overlay design system
 * - Active/inactive states with customizable colors
 * - Hover effects
 * - Small size (24x24px) with proportional icons
 * 
 * Usage:
 * ```tsx
 * <SceneControlButton
 *   onClick={handleClick}
 *   icon={<svg>...</svg>}
 *   title="Button description"
 *   isActive={isActive}
 *   activeColor={UI_COLORS.PRIMARY}
 * />
 * ```
 */
export function SceneControlButton({
  onClick,
  icon,
  title,
  isActive = false,
  activeColor = 'var(--color-primary)',
  inactiveBackground = 'var(--color-secondary-lighter)',
  border = true ,
  background = true
}: SceneControlButtonProps) {
  return (
    <button
      onClick={onClick}
      className="backdrop-blur-sm shadow-lg transition-all duration-200 flex items-center justify-center group"
      style={{
        width: UI_SCENE_BUTTON.SIZE,
        height: UI_SCENE_BUTTON.SIZE,
        borderRadius: UI_SCENE_BUTTON.BORDER_RADIUS,
        backgroundColor: background? isActive ? activeColor : inactiveBackground : "transparent",
        borderColor: isActive ? activeColor : 'var(--color-overlay-border)',
        borderWidth: border? '1px': '0px',
        borderStyle: 'solid'
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'var(--color-overlay-border)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          if (background) {
            e.currentTarget.style.backgroundColor = inactiveBackground;
          }
          else {
            e.currentTarget.style.backgroundColor = "transparent";            
          }
        }
      }}
      title={title}
    >
      {icon}
    </button>
  );
}
