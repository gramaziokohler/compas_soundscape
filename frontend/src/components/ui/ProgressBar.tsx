"use client";

interface ProgressBarProps {
  /** Completed fraction, 0–1 (clamped). */
  value: number;
  className?: string;
  /** Accessible label for the progressbar role. */
  label?: string;
}

/**
 * Thin determinate progress bar (primary fill on a muted track).
 *
 * @example
 *   <ProgressBar value={0.42} label="Converting model" />
 */
export function ProgressBar({ value, className = "", label }: ProgressBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={`h-1 w-full overflow-hidden rounded-full bg-secondary-light ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
