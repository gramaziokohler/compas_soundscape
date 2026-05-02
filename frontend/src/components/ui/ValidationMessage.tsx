"use client";

import { ReactNode } from "react";
import { UI_VALIDATION, TAILWIND_TEXT_SIZE } from "@/utils/constants";

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
  const typeClasses: Record<MessageType, string> = {
    error:   'bg-error-light border-error text-error-hover',
    success: 'bg-success-light border-success text-success-hover',
    info:    'bg-info-light border-info text-info-hover',
    warning: 'bg-warning-light border-warning text-warning-hover',
  };

  return (
    <div
      className={`${TAILWIND_TEXT_SIZE.XS} flex items-start gap-2 border ${typeClasses[type]} ${className}`}
      style={{
        padding: UI_VALIDATION.PADDING,
        borderRadius: `${UI_VALIDATION.BORDER_RADIUS}px`,
        borderWidth: `${UI_VALIDATION.BORDER_WIDTH}px`,
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
