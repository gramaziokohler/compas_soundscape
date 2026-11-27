"use client";

interface SpinnerProps {
  size?: number | string;
  className?: string;
  /** Ring thickness in px (default 3). */
  thickness?: number;
}

export function Spinner({ size = 16, className = "", thickness = 3 }: SpinnerProps) {
  return (
    <span
      className={`inline-block rounded-full border-primary border-t-transparent animate-spin ${className}`}
      style={{ width: size, height: size, borderWidth: thickness, borderStyle: "solid" }}
      role="status"
      aria-label="Loading"
    />
  );
}
