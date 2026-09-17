"use client";

import { Check, Minus } from "lucide-react";

export interface CheckboxProps {
  /** Whether the checkbox is fully checked. */
  checked: boolean;
  /** Render the mixed state (some, but not all, descendants checked). */
  indeterminate?: boolean;
  disabled?: boolean;
  /** Called with the next checked value. Stop propagation is applied for tree rows. */
  onChange?: (checked: boolean) => void;
  /** Accessible label (falls back to `title`). */
  label?: string;
  title?: string;
  /** Box size in px. Defaults to 16. */
  size?: number;
  className?: string;
}

/**
 * Checkbox Component
 *
 * Compact, token-driven tri-state checkbox (checked / unchecked / indeterminate).
 * Used by the Object Explorer acoustic-region selection. Renders as a real
 * `button[role=checkbox]` so keyboard (Enter/Space) works, and stops click
 * propagation so it composes inside clickable rows without double-toggling.
 *
 * Usage:
 * ```tsx
 * <Checkbox checked={isChecked} indeterminate={isMixed} onChange={() => toggle()} />
 * ```
 */
export function Checkbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
  title,
  size = 16,
  className = "",
}: CheckboxProps) {
  const active = checked || indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label ?? title}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange?.(!checked);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`shrink-0 inline-flex items-center justify-center rounded-sm border transition-colors ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: active ? "var(--color-primary)" : "transparent",
        borderColor: active ? "var(--color-primary)" : "var(--color-border-strong)",
        color: "var(--color-on-blue)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {indeterminate ? (
        <Minus size={size - 5} strokeWidth={3} />
      ) : checked ? (
        <Check size={size - 4} strokeWidth={3} />
      ) : null}
    </button>
  );
}

export default Checkbox;
