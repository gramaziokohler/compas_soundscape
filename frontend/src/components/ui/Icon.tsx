"use client";

import { ReactNode } from "react";
import { SVG_ICON_PROPS, UI_SCENE_BUTTON } from "@/utils/constants";

interface IconProps {
  children: ReactNode;
  size?: string;
  className?: string;
  color?: string;
  strokeWidth?: string;
}

/**
 * Icon Component
 * 
 * Standardized SVG wrapper for icons with consistent attributes.
 * Automatically applies xmlns, viewBox, and common stroke properties.
 * 
 * Usage:
 * ```tsx
 * <Icon>
 *   <path d="M..." />
 * </Icon>
 * ```
 */
export function Icon({ 
  children, 
  size = UI_SCENE_BUTTON.ICON_SIZE, 
  className = "",
  color = "currentColor",
  strokeWidth = SVG_ICON_PROPS.STROKE_WIDTH
}: IconProps) {
  return (
    <svg
      xmlns={SVG_ICON_PROPS.XMLNS}
      viewBox="0 0 24 24"
      fill={SVG_ICON_PROPS.FILL}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap={SVG_ICON_PROPS.STROKE_LINECAP}
      strokeLinejoin={SVG_ICON_PROPS.STROKE_LINEJOIN}
      style={{ width: size, height: size }}
      className={`transition-colors ${className}`}
    >
      {children}
    </svg>
  );
}

/**
 * RefreshIcon Component
 *
 * Canonical refresh/reload glyph (feather `refresh-cw`), shared across all
 * refresh / recreate / reset-style actions so they stay visually consistent.
 *
 * Usage:
 * ```tsx
 * <RefreshIcon size="0.75rem" />
 * ```
 */
export function RefreshIcon({ size = "0.8rem" }: { size?: string }) {
  return (
    <Icon size={size}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </Icon>
  );
}
