"use client";

import { UI_BORDER_RADIUS } from "@/utils/constants";

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  variant?: "danger" | "default";
}

/**
 * ConfirmDialog Component
 *
 * Inline confirmation prompt with Cancel / Confirm buttons.
 *
 * Features:
 * - Two variants: "danger" (red, destructive) and "default" (primary, neutral)
 * - Disabled state for in-flight operations (shows loading label)
 * - Color tokens from CSS custom properties — no hex values
 * - Consistent border radius from UI_BORDER_RADIUS design system
 *
 * Usage:
 * ```tsx
 * {showConfirm && (
 *   <ConfirmDialog
 *     message="Are you sure?"
 *     onConfirm={() => handleDelete()}
 *     onCancel={() => setShowConfirm(false)}
 *     variant="danger"
 *   />
 * )}
 * ```
 */
export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  disabled = false,
  variant = "default",
}: ConfirmDialogProps) {
  const isDanger = variant === "danger";
  const accentColor = isDanger ? "var(--color-error)" : "var(--color-primary)";
  const accentBg = isDanger
    ? "color-mix(in srgb, var(--color-error) 8%, transparent)"
    : "color-mix(in srgb, var(--color-primary) 8%, transparent)";

  return (
    <div
      className="flex flex-col gap-2 p-2 rounded"
      style={{
        background: accentBg,
        border: `1px solid ${accentColor}`,
        borderRadius: `${UI_BORDER_RADIUS.SM}px`,
      }}
    >
      <p
        className="text-[10px] font-medium"
        style={{ color: accentColor }}
      >
        {message}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={disabled}
          className="flex-1 py-1 text-[10px] font-medium rounded transition-colors disabled:opacity-40"
          style={{
            background: "var(--color-secondary-lighter)",
            color: "var(--foreground)",
            border: "1px solid var(--color-secondary-light)",
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
          }}
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="flex-1 py-1 text-[10px] font-medium rounded transition-colors disabled:opacity-40"
          style={{
            background: accentColor,
            color: "white",
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
          }}
        >
          {disabled ? `${confirmLabel}…` : confirmLabel}
        </button>
      </div>
    </div>
  );
}
