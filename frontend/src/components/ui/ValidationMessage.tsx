"use client";

import { ReactNode } from "react";
import { UI_COLORS, UI_VALIDATION, TAILWIND_TEXT_SIZE } from "@/lib/constants";

type MessageType = "error" | "success" | "info" | "warning";

interface ValidationMessageProps {
  type: MessageType;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * ValidationMessage Component
 * 
 * Reusable validation/status message component with consistent styling.
 * Used throughout the app for errors, success messages, info, and warnings.
 * 
 * Features:
 * - Color-coded by type (error: red, success: green, info: blue, warning: amber)
 * - Border styling for validation messages
 * - Optional icon support
 * - Consistent padding and border radius
 * - Text size from design system
 * 
 * Usage:
 * ```tsx
 * <ValidationMessage type="error">
 *   Failed to load file
 * </ValidationMessage>
 * 
 * <ValidationMessage type="success" icon={<CheckIcon />}>
 *   Analysis complete!
 * </ValidationMessage>
 * ```
 */
export function ValidationMessage({
  type,
  children,
  icon,
  className = ""
}: ValidationMessageProps) {
  const getColors = () => {
    switch (type) {
      case "error":
        return {
          bg: UI_COLORS.ERROR_LIGHT,
          border: UI_COLORS.ERROR,
          text: UI_COLORS.ERROR_HOVER
        };
      case "success":
        return {
          bg: UI_COLORS.SUCCESS_LIGHT,
          border: UI_COLORS.SUCCESS,
          text: UI_COLORS.SUCCESS_HOVER
        };
      case "info":
        return {
          bg: UI_COLORS.INFO_LIGHT,
          border: UI_COLORS.INFO,
          text: UI_COLORS.INFO_HOVER
        };
      case "warning":
        return {
          bg: UI_COLORS.WARNING_LIGHT,
          border: UI_COLORS.WARNING,
          text: UI_COLORS.WARNING_HOVER
        };
    }
  };

  const colors = getColors();

  return (
    <div
      className={`${TAILWIND_TEXT_SIZE.XS} flex items-start gap-2 ${className}`}
      style={{
        padding: `${UI_VALIDATION.PADDING}`,
        borderRadius: `${UI_VALIDATION.BORDER_RADIUS}px`,
        borderWidth: `${UI_VALIDATION.BORDER_WIDTH}px`,
        borderStyle: "solid",
        borderColor: colors.border,
        backgroundColor: colors.bg,
        color: colors.text
      }}
    >
      {icon && (
        <span
          className="flex-shrink-0"
          style={{
            width: `${UI_VALIDATION.ICON_SIZE}px`,
            height: `${UI_VALIDATION.ICON_SIZE}px`
          }}
        >
          {icon}
        </span>
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}
