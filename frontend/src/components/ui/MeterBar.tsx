"use client";

import type { MeterLevel } from "@/types";

export interface MeterBarProps {
  /** Fill 0..1 (null = no data: an empty track). */
  value: number | null;
  /** Peak-hold tick position 0..1 (omit for none). */
  peak?: number;
  level: MeterLevel;
  /** Track width in px. */
  width: number;
  /** Thin variant for inline strips. */
  compact?: boolean;
  title?: string;
}

/**
 * MeterBar Component
 *
 * DAW-style horizontal level bar: a track, a fill coloured by level
 * (ok / warn / crit via `.meter-bar--*` tokens in globals.css) animated with
 * `transform: scaleX`, and an optional peak-hold tick.
 *
 * Usage:
 * ```tsx
 * <MeterBar value={0.42} peak={0.6} level="warn" width={32} compact />
 * ```
 */
export function MeterBar({ value, peak, level, width, compact = false, title }: MeterBarProps) {
  return (
    <span
      className={`meter-bar meter-bar--${level}${compact ? " meter-bar--compact" : ""}`}
      style={{ width }}
      title={title}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value ?? undefined}
      aria-label={title}
    >
      <span className="meter-bar__fill" style={{ transform: `scaleX(${value ?? 0})` }} />
      {peak !== undefined && peak > 0 && <span className="meter-bar__peak" style={{ left: `${peak * 100}%` }} />}
    </span>
  );
}
