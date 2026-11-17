/**
 * IR energy helpers — the single definition of a "Low energy" IR, shared by the
 * IR list badge (ImpulseResponseUpload) and the averaged simulation metrics
 * (acousticMetrics), so both always agree on which IRs are tagged.
 */

import { IR_LOW_ENERGY_THRESHOLD } from '@/utils/constants';

/** True when a peak amplitude marks a low-energy / silent IR: non-finite or non-positive
 *  values (a negative value means the peak is stored/displayed in dB, e.g. -89.9 dB) or an
 *  amplitude below IR_LOW_ENERGY_THRESHOLD. */
export function isLowEnergyPeak(peak: number | null | undefined): boolean {
  if (peak === undefined || peak === null) return false;
  if (!Number.isFinite(peak) || peak <= 0) return true;
  return peak < IR_LOW_ENERGY_THRESHOLD;
}

/** Low-energy check from IR metadata alone (server `peak_amplitude`, no audio download). */
export function isLowEnergyIR(meta: { peak_amplitude?: number; peakAmplitude?: number } | null | undefined): boolean {
  return isLowEnergyPeak(meta?.peak_amplitude ?? meta?.peakAmplitude);
}
