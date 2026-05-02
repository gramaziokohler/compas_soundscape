"use client";

import { ReactNode } from "react";
import { TAILWIND_TEXT_SIZE, TAILWIND_ROUNDED, TAILWIND_TRANSITION } from "@/utils/constants";

interface ButtonGroupItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  isActive: boolean;
  activeColor?: string;
  inactiveColor?: string;
  title?: string;
}

interface ButtonGroupProps {
  buttons: ButtonGroupItem[];
  className?: string;
}

/**
 * ButtonGroup Component
 * 
 * Reusable group of buttons with consistent spacing and styling.
 * Used for Mute/Solo buttons in SoundUIOverlay and EntityUIOverlay.
 * 
 * Features:
 * - Flex layout with gap-2
 * - Equal width buttons (flex-1)
 * - Active/inactive states with customizable colors
 * - Icon + label support
 * - Consistent padding and transitions
 * 
 * Usage:
 * ```tsx
 * <ButtonGroup
 *   buttons={[
 *     {
 *       label: isMuted ? '🔇 Muted' : '🔊 Mute',
 *       onClick: handleMute,
 *       isActive: isMuted,
 *       activeColor: UI_COLORS.WARNING,
 *       title: 'Mute sound'
 *     },
 *     {
 *       label: isSoloed ? '⭐ Solo' : 'Solo',
 *       onClick: handleSolo,
 *       isActive: isSoloed,
 *       activeColor: UI_COLORS.PRIMARY,
 *       title: 'Solo sound'
 *     }
 *   ]}
 * />
 * ```
 */
export function ButtonGroup({ buttons, className = "" }: ButtonGroupProps) {
  return (
    <div className={`flex gap-2 ${className}`}>
      {buttons.map((button, index) => (
        <button
          key={index}
          onClick={button.onClick}
          className={`flex-1 py-2 ${TAILWIND_ROUNDED.MD} font-medium ${TAILWIND_TEXT_SIZE.SM} ${TAILWIND_TRANSITION.COLORS} ${
            button.isActive ? 'text-white' : 'text-neutral-300'
          }`}
          style={{
            backgroundColor: button.isActive
              ? button.activeColor || 'var(--color-primary)'
              : button.inactiveColor || 'var(--color-secondary)'
          }}
          title={button.title}
        >
          {button.icon && <span className="inline-block mr-1">{button.icon}</span>}
          {button.label}
        </button>
      ))}
    </div>
  );
}
