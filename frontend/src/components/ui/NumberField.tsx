"use client";

/**
 * NumberField Component
 *
 * Monospace numeric field styled to match the card design system (`.text-input`
 * in the Reference). Centered, mono font, dark field background with a subtle
 * border that highlights on focus. Composes the shared `.xyz-input` look so any
 * x/y/z position widget or numeric input reads consistently.
 *
 * - Values are **truncated to 2 decimals** on display (live text while editing).
 * - An optional `prefix` renders the axis letter (X / Y / Z) inside the field.
 * - `onCommit` fires on blur / Enter with the parsed number (or `null` when the
 *   field was cleared) — used by commit-style inputs like the scattering
 *   coefficient, which only write to the store on commit.
 *
 * Usage:
 * ```tsx
 * <NumberField value={x} prefix="X" onChange={(v) => setPos([v, y, z])} />
 * <NumberField value={scatter} onCommit={(v) => assignScattering(v)} placeholder="mix" />
 * ```
 */
import { useEffect, useState } from "react";
import type { CSSProperties, InputHTMLAttributes } from "react";

export interface NumberFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "onBlur" | "onKeyDown" | "value"> {
  /** Current numeric value; `null` renders empty (placeholder). */
  value: number | null;
  /** Live callback with the parsed number. Not fired on NaN input. */
  onChange?: (value: number) => void;
  /** Commit callback on blur / Enter — parsed number or `null` when cleared. */
  onCommit?: (value: number | null) => void;
  /** Axis label rendered inside the field (X / Y / Z). */
  prefix?: string;
  /** Decimals shown when not editing. Default 2. */
  precision?: number;
  /** Keyboard handler forwarded to the input (Enter still commits). */
  onKeyDown?: InputHTMLAttributes<HTMLInputElement>["onKeyDown"];
  /** Inline style for the wrapper span (sizing / flex-grow in a row). */
  containerStyle?: CSSProperties;
  /** When true, recolors the field for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

export function NumberField({
  value,
  onChange,
  onCommit,
  prefix,
  precision = 2,
  disabled,
  placeholder,
  onKeyDown,
  className = "",
  containerStyle,
  onBlueBackground = false,
  ...rest
}: NumberFieldProps) {
  // Draft holds the raw text while the user is typing. `null` = not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Re-sync display when the external value changes and we are not editing.
  useEffect(() => {
    if (!isEditing) setDraft(null);
  }, [value, isEditing]);

  const displayValue =
    draft !== null
      ? draft
      : value === null || !Number.isFinite(value)
        ? ""
        : value.toFixed(precision);

  const commit = () => {
    setIsEditing(false);
    const raw = draft ?? "";
    if (raw.trim() === "") {
      setDraft(null);
      onCommit?.(null);
      return;
    }
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) {
      setDraft(null);
      return;
    }
    setDraft(null);
    onChange?.(parsed);
    onCommit?.(parsed);
  };

  return (
    <span
      className="relative inline-block align-middle"
      style={{ minWidth: 0, ...containerStyle }}
    >
      <input
        type="number"
        inputMode="decimal"
        value={displayValue}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) onChange?.(parsed);
        }}
        onFocus={() => {
          setIsEditing(true);
          setDraft(value === null ? "" : value.toFixed(precision));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
          onKeyDown?.(e);
        }}
        className={`xyz-input w-full ${prefix ? "pl-5 pr-1 text-left" : "text-center"} ${onBlueBackground ? "on-blue" : ""} ${className} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        {...rest}
      />
      {prefix && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-medium uppercase select-none ${onBlueBackground ? "" : "text-text-3"}`}
          style={onBlueBackground ? { color: 'var(--color-on-blue-muted)' } : undefined}
        >
          {prefix}
        </span>
      )}
    </span>
  );
}

export default NumberField;