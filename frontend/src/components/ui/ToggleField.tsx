"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";

export interface ToggleFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Optional metadata chip shown beside the label; tints primary when checked. */
  badge?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Recessed badge styling when rendered on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

/**
 * ToggleField Component
 *
 * Toggle-switch alternative to CheckboxField: label (and optional badge) on the
 * left, switch on the right. Checked state tints label and badge with primary
 * tokens; switch track uses `--color-primary`. Theme-aware via globals.css
 * `.toggle-row` / `.toggle-switch` rules (light + dark + `.card-generated`).
 *
 * Usage:
 * ```tsx
 * <ToggleField
 *   checked={isEnabled}
 *   onChange={setIsEnabled}
 *   label="Enable this feature"
 *   badge="Beta"
 * />
 * ```
 */
export function ToggleField({
  checked,
  onChange,
  label,
  badge,
  disabled = false,
  className = "",
  onBlueBackground = false,
}: ToggleFieldProps) {
  return (
    <label
      className={`toggle-row ${checked ? "checked" : ""} ${className}`}
      style={{ opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      onClick={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="toggle-row__content">
        <span className="toggle-row__label">{label}</span>
        {badge != null && badge !== "" && (
          <Badge
            variant={checked ? "primary" : "neutral"}
            onBlueBackground={onBlueBackground}
          >
            {badge}
          </Badge>
        )}
      </span>
      <span
        aria-hidden
        role="switch"
        aria-checked={checked}
        className={`toggle-switch ${checked ? "checked" : ""}`}
      />
    </label>
  );
}
