"use client";

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
 * Custom 14px checkbox (blue fill + white check) with label in a consistent
 * `.ck-row` layout. Rendered via the shared `.ck` / `.ck-row` CSS so styling is
 * centralized — no native-browser checkbox chrome.
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
      className={`ck-row ${className}`}
      style={{ opacity: disabled ? 0.6 : 1 }}
      onClick={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span
        aria-hidden
        className={`ck ${checked ? 'checked' : ''}`}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <span style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>{label}</span>
    </label>
  );
}
