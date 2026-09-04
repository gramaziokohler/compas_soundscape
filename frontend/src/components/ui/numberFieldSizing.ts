/**
 * Shared sizing helpers for `NumberField` instances embedded in sliders (`RangeSlider`,
 * `VerticalVolumeSlider`) and position editors (`PositionWidget`) — keeps their editable
 * value fields sized just wide enough for their content instead of a guessed fixed width.
 */

/** Number of decimal places implied by a step value (0.5 -> 1, 0.1 -> 1, 1 -> 0). */
export function decimalsFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const str = step.toString();
  const dotIndex = str.indexOf(".");
  return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
}

/**
 * Approximate character width for an editable numeric field, based on its value range.
 * `buffer` accounts for the field's own padding/cursor room — pass a smaller buffer when
 * no unit is shown inline next to the digits (e.g. unit rendered on its own line below).
 */
export function estimateFieldWidthCh(min: number, max: number, precision: number, buffer = 1.5): number {
  const maxAbs = Math.max(Math.abs(min), Math.abs(max), 1);
  const intDigits = Math.floor(Math.log10(maxAbs)) + 1;
  const hasNegative = min < 0;
  const decimalChars = precision > 0 ? precision + 1 : 0;
  return intDigits + decimalChars + (hasNegative ? 1 : 0) + buffer;
}

/** Matches NumberField axis-prefix gutter (`pl-4`, includes prefix `pr-1`). */
export const PREFIXED_NUMBER_FIELD_PREFIX_REM = 1;

/** CSS width for a prefixed NumberField — prefix gutter + digit columns only. */
export function estimatePrefixedNumberFieldWidth(value: number, precision: number): string {
  const digitsCh = Number.isFinite(value)
    ? value.toFixed(precision).length
    : precision > 0
      ? 2 + precision
      : 1;
  return `calc(${PREFIXED_NUMBER_FIELD_PREFIX_REM}rem + ${digitsCh}ch)`;
}
