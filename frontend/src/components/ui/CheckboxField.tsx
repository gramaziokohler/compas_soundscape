"use client";

import { UI_CHECKBOX, TAILWIND_TEXT_SIZE, TAILWIND_PADDING } from "@/utils/constants";

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
    <label
      className={`flex items-center gap-1 ${TAILWIND_PADDING.SM} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${className}`}
      style={{ opacity: disabled ? 0.6 : 1 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-3.5 h-3.5 rounded focus:ring-2"
        style={{
          borderRadius: `${UI_CHECKBOX.BORDER_RADIUS}px`,
          accentColor: 'var(--card-color, var(--color-primary))',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      />
      <span
        className="text-xs text-secondary-hover"
      >
        {label}
      </span>
    </label>
  );
}
