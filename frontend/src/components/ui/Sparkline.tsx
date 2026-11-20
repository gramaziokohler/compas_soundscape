"use client";

import type { MeterLevel } from "@/types";

export interface SparklineProps {
  /** Values 0..1, oldest first. */
  values: readonly number[];
  /** Number of slots across the width (older values scroll off the left). */
  length: number;
  width: number;
  height: number;
  level: MeterLevel;
}

/**
 * Sparkline Component
 *
 * Tiny SVG history line for meters, coloured by level through
 * `.sparkline--*` tokens in globals.css (stroke = currentColor).
 *
 * Usage:
 * ```tsx
 * <Sparkline values={history} length={60} width={48} height={12} level="ok" />
 * ```
 */
export function Sparkline({ values, length, width, height, level }: SparklineProps) {
  const step = length > 1 ? width / (length - 1) : width;
  const offset = length - values.length;
  const points = values
    .map((v, i) => `${((offset + i) * step).toFixed(1)},${(height - Math.max(0, Math.min(1, v)) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg className={`sparkline sparkline--${level}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {values.length > 1 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1} />}
    </svg>
  );
}
