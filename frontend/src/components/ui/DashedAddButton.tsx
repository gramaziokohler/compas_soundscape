'use client';

import type { CSSProperties, ReactNode } from 'react';

export interface DashedAddButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  width?: number;
  height?: number;
  icon?: ReactNode;
  iconSize?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Reusable dashed "+" action button used across card UIs.
 * Light: transparent fill, primary dashed border and icon.
 * Dark: primary fill, on-blue dashed border and icon.
 * Hover (both): background becomes primary-hover only.
 */
export function DashedAddButton({
  onClick,
  title,
  disabled = false,
  width = 22,
  height = 22,
  icon = '+',
  iconSize = 12,
  className,
  style,
}: DashedAddButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border border-dashed border-primary bg-transparent text-primary dark:border-on-blue dark:bg-primary dark:text-on-blue enabled:hover:bg-primary-hover flex items-center justify-center transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${className ?? ''}`}
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
}