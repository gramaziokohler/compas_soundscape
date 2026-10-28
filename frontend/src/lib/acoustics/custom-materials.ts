/**
 * Band helpers for user-defined acoustic materials.
 *
 * Custom materials always use CUSTOM_MATERIAL.CENTER_FREQS (7 octave bands);
 * built-in templates may use other bands, so their coefficients are resampled
 * to the nearest band on a log-frequency axis.
 */

import { CUSTOM_MATERIAL } from '@/utils/constants';

const BANDS: readonly number[] = CUSTOM_MATERIAL.CENTER_FREQS;

/** Coefficients mapped onto CUSTOM_MATERIAL.CENTER_FREQS (nearest source band in log frequency). */
export function resampleToCustomBands(coeffs: number[], centerFreqs: number[] | undefined): number[] {
  if (coeffs.length === 0) return BANDS.map(() => CUSTOM_MATERIAL.DEFAULT_COEFF);
  const freqs = centerFreqs && centerFreqs.length === coeffs.length ? centerFreqs : BANDS.slice(0, coeffs.length);
  return BANDS.map((target) => {
    let best = 0;
    for (let i = 1; i < freqs.length; i++) {
      if (Math.abs(Math.log2(freqs[i] / target)) < Math.abs(Math.log2(freqs[best] / target))) best = i;
    }
    return clampCoeff(coeffs[best]);
  });
}

export function clampCoeff(value: number): number {
  return Math.min(CUSTOM_MATERIAL.COEFF_MAX, Math.max(CUSTOM_MATERIAL.COEFF_MIN, value));
}

export function meanAbsorption(coeffs: number[]): number {
  return coeffs.length === 0 ? 0 : coeffs.reduce((a, b) => a + b, 0) / coeffs.length;
}

/** True when every band has (practically) the same coefficient. */
export function isFlat(coeffs: number[]): boolean {
  return coeffs.every((c) => Math.abs(c - coeffs[0]) < CUSTOM_MATERIAL.COEFF_STEP / 2);
}

/** Short band label: 125 → "125 Hz", 2000 → "2 kHz". */
export function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
}
