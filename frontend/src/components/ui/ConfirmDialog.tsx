"use client";

import { UI_BORDER_RADIUS } from "@/utils/constants";

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  /** Only disable the confirm button — cancel stays active. */
  disableConfirm?: boolean;
  variant?: "danger" | "default";
  /** When true, recolors the "default" variant for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
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
  disableConfirm = false,
  variant = "default",
  onBlueBackground = false,
}: ConfirmDialogProps) {
  const isDanger = variant === "danger";
  const accentColor = isDanger ? "var(--color-error)" : "var(--color-primary)";
  const accentBg = isDanger
    ? "color-mix(in srgb, var(--color-error) 8%, transparent)"
    : onBlueBackground
      ? "color-mix(in srgb, var(--color-on-blue) 60%, transparent)"
      : "color-mix(in srgb, var(--background-static) 65%, transparent)";
  const confirmDisabled = disabled || disableConfirm;

  return (
    <div
      className="flex flex-col gap-2 p-2 rounded"
      style={{
        background: accentBg
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
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
          }}
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirmDisabled}
          className="flex-1 py-1 text-[10px] font-medium rounded transition-colors disabled:opacity-40"
          style={{
            background: accentColor,
            color: "white",
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
          }}
        >
          {confirmDisabled ? `${confirmLabel}…` : confirmLabel}
        </button>
      </div>
    </div>
  );
}
