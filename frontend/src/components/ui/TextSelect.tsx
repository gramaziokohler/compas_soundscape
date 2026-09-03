"use client";

export interface TextSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Native tooltip shown on hover. */
  title?: string;
}

export interface TextSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: TextSelectOption[];
  disabled?: boolean;
  className?: string;
  /** Smaller padding/font, matching CardSelect compact triggers. */
  compact?: boolean;
}

/**
 * TextSelect Component
 *
 * Horizontal row of plain-text options. Click a label to select it.
 * Hover colors the text; the selected option gets a rounded primary border
 * and primary text color. Used by CardSelect when there are few options.
 *
 * Usage:
 * ```tsx
 * <TextSelect
 *   value={theme}
 *   onChange={setTheme}
 *   options={[
 *     { value: 'system', label: 'System' },
 *     { value: 'light', label: 'Light' },
 *     { value: 'dark', label: 'Dark' },
 *   ]}
 * />
 * ```
 */
export function TextSelect({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  compact = false,
}: TextSelectProps) {
  return (
    <div
      role="radiogroup"
      className={`text-select ${compact ? "compact" : ""} ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const isDisabled = disabled || !!opt.disabled;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              onChange(opt.value);
            }}
            className={`text-select-opt ${active ? "active" : ""}`}
            title={opt.title}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
