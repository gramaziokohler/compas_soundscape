/**
 * Magnitude response of a biquad cascade — used by the EQ curve overlay.
 * Coefficients follow the Web Audio spec filter characteristics.
 */

import type { EqBand } from './fx-types';

export function eqMagnitudeDb(bands: EqBand[], freq: number, sampleRate: number): number {
  let mag = 1;
  for (const band of bands) {
    if (!band.enabled) continue;
    const c = biquadCoeffs(band, sampleRate);
    if (!c) continue;
    mag *= biquadMag(c, freq, sampleRate);
  }
  if (mag <= 1e-12) return -80;
  return 20 * Math.log10(mag);
}

interface Coeffs {
  b0: number; b1: number; b2: number;
  a0: number; a1: number; a2: number;
}

function biquadCoeffs(band: EqBand, sampleRate: number): Coeffs | null {
  const f0 = Math.max(10, Math.min(sampleRate * 0.49, band.freq));
  const w0 = 2 * Math.PI * f0 / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.max(0.0001, band.q);
  const A = Math.pow(10, band.gain / 40);
  const alpha = sin / (2 * Q);

  switch (band.type) {
    case 'highpass':
      return {
        b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2,
        a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha,
      };
    case 'lowpass':
      return {
        b0: (1 - cos) / 2, b1: 1 - cos, b2: (1 - cos) / 2,
        a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha,
      };
    case 'peaking': {
      return {
        b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A,
        a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A,
      };
    }
    case 'lowshelf': {
      const sqrtA = Math.sqrt(A);
      return {
        b0: A * ((A + 1) - (A - 1) * cos + 2 * sqrtA * alpha),
        b1: 2 * A * ((A - 1) - (A + 1) * cos),
        b2: A * ((A + 1) - (A - 1) * cos - 2 * sqrtA * alpha),
        a0: (A + 1) + (A - 1) * cos + 2 * sqrtA * alpha,
        a1: -2 * ((A - 1) + (A + 1) * cos),
        a2: (A + 1) + (A - 1) * cos - 2 * sqrtA * alpha,
      };
    }
    case 'highshelf': {
      const sqrtA = Math.sqrt(A);
      return {
        b0: A * ((A + 1) + (A - 1) * cos + 2 * sqrtA * alpha),
        b1: -2 * A * ((A - 1) + (A + 1) * cos),
        b2: A * ((A + 1) + (A - 1) * cos - 2 * sqrtA * alpha),
        a0: (A + 1) - (A - 1) * cos + 2 * sqrtA * alpha,
        a1: 2 * ((A - 1) - (A + 1) * cos),
        a2: (A + 1) - (A - 1) * cos - 2 * sqrtA * alpha,
      };
    }
    default:
      return null;
  }
}

function biquadMag(c: Coeffs, freq: number, sampleRate: number): number {
  const w = 2 * Math.PI * freq / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2;
  const numIm = 0 - c.b1 * sw - c.b2 * s2;
  const denRe = c.a0 + c.a1 * cw + c.a2 * c2;
  const denIm = 0 - c.a1 * sw - c.a2 * s2;
  const n = Math.hypot(numRe, numIm);
  const d = Math.hypot(denRe, denIm);
  return d > 1e-12 ? n / d : 1;
}
