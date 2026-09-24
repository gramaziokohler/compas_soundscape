"use client";

import { ReactNode } from "react";
import { NOTIFICATIONS, UI_BORDER_RADIUS, UI_SCENE_BUTTON } from "@/utils/constants";

interface SceneControlButtonProps {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  isActive?: boolean;
  activeColor?: string;
  inactiveBackground?: string;
  border?: boolean
  background?: boolean
  /** Optional DOM id (e.g. for anchor/animation targets). */
  buttonId?: string
  /** Optional count badge (e.g. unread notifications). Hidden when 0/undefined. */
  badge?: number
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
  inactiveBackground = 'var(--sidebar-bg)',
  border = true ,
  background = true,
  buttonId,
  badge
}: SceneControlButtonProps) {
  return (
    <button
      id={buttonId}
      onClick={onClick}
      className="frosted-surface backdrop-blur-lg backdrop-saturate-150 shadow-lg transition-all duration-200 flex items-center justify-center group"
      style={{
        position: 'relative',
        width: UI_SCENE_BUTTON.SIZE,
        height: UI_SCENE_BUTTON.SIZE,
        borderRadius: UI_SCENE_BUTTON.BORDER_RADIUS,
        backgroundColor: background? isActive ? activeColor : inactiveBackground : "transparent",
        color: isActive
          ? (activeColor === 'var(--color-warning)' ? 'var(--foreground)' : 'var(--color-on-blue)')
          : 'var(--foreground)',
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
      {badge != null && badge > 0 && (
        <span
          className="pointer-events-none flex items-center justify-center"
          style={{
            position: 'absolute',
            top: '-5px',
            right: '-5px',
            minWidth: '14px',
            height: '14px',
            padding: '0 3px',
            borderRadius: UI_BORDER_RADIUS.FULL,
            backgroundColor: 'var(--color-error)',
            color: 'var(--color-on-blue)',
            fontSize: '9px',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {badge > NOTIFICATIONS.BADGE_MAX ? `${NOTIFICATIONS.BADGE_MAX}+` : badge}
        </span>
      )}
    </button>
  );
}
