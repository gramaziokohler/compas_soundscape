"use client";

import { UI_CHECKBOX, UI_COLORS, TAILWIND_TEXT_SIZE, TAILWIND_PADDING } from "@/lib/constants";

interface CheckboxFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * CheckboxField Component
 * 
 * Reusable checkbox with label in a consistent layout.
 * Used throughout sidebar sections (ModelLoadSection, ImpulseResponseUpload, etc.)
 * 
 * Features:
 * - Checkbox + label in flex layout with gap
 * - Primary accent color
 * - Consistent sizing (w-4 h-4)
 * - Focus ring on keyboard navigation
 * - Disabled state support
 * - Cursor pointer for better UX
 * 
 * Usage:
 * ```tsx
 * <CheckboxField
 *   checked={isEnabled}
 *   onChange={setIsEnabled}
 *   label="Enable this feature"
 * />
 * ```
 */
export function CheckboxField({
  checked,
  onChange,
  label,
  disabled = false,
  className = ""
}: CheckboxFieldProps) {
  return (
    <label className={`flex items-center gap-2 ${TAILWIND_PADDING.SM} cursor-pointer ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 rounded focus:ring-2 accent-primary"
        style={{
          borderRadius: `${UI_CHECKBOX.BORDER_RADIUS}px`,
          accentColor: UI_COLORS.PRIMARY
        }}
      />
      <span 
        className={TAILWIND_TEXT_SIZE.XS}
        style={{ 
          color: disabled ? UI_COLORS.NEUTRAL_400 : UI_COLORS.NEUTRAL_700 
        }}
      >
        {label}
      </span>
    </label>
  );
}
