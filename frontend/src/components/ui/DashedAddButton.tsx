'use client';

import type { CSSProperties, ReactNode } from 'react';

export interface DashedAddButtonProps {
  onClick: () => void;
  title: string;
  /** Optional text label rendered to the left of the button. */
  label?: string;
  disabled?: boolean;
  width?: number;
  height?: number;
  icon?: ReactNode;
  iconSize?: number;
  className?: string;
  style?: CSSProperties;
  /** When true, label uses on-blue muted text (for generated card backgrounds). */
  onBlueBackground?: boolean;
}

/**
 * Reusable dashed "+" action button used across card UIs.
 * Light: transparent fill, primary dashed border and icon.
 * Dark: primary fill, on-blue dashed border and icon.
 * Hover (both): background becomes primary-hover only.
 * onBlueBackground: white dashed border/icon on generated card backgrounds.
 *
 * Usage:
 * ```tsx
 * <DashedAddButton onClick={handleAdd} title="Add item" label="Variants" />
 * ```
 */
export function DashedAddButton({
  onClick,
  title,
  label,
  disabled = false,
  width = 22,
  height = 22,
  icon = '+',
  iconSize = 12,
  className,
  style,
  onBlueBackground = false,
}: DashedAddButtonProps) {
  const buttonClassName = onBlueBackground
    ? 'rounded border border-dashed border-on-blue-muted bg-transparent text-on-blue enabled:hover:bg-blue-chip-bg enabled:hover:border-on-blue'
    : 'rounded border border-dashed border-primary bg-transparent text-primary dark:border-on-blue dark:bg-primary dark:text-on-blue enabled:hover:bg-primary-hover';

  const button = (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${buttonClassName} flex items-center justify-center transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${className ?? ''}`}
      style={{
        width,
        height,
        lineHeight: 1,
        ...style,
      }}
      aria-label={title}
    >
      <span style={{ fontSize: iconSize, lineHeight: 1 }}>{icon}</span>
    </button>
  );

  if (!label) {
    return button;
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span
        className={`text-xxs whitespace-nowrap ${onBlueBackground ? 'text-on-blue-muted' : 'text-secondary-hover'}`}
      >
        {label}
      </span>
      {button}
    </div>
  );
}