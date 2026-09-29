/**
 * WaveShaper curve generators for saturation / distortion.
 * Curves are precomputed once per param change and assigned to WaveShaperNode.curve.
 */

const CURVE_LENGTH = 2048;

function fillSymmetric(map: (x: number) => number): Float32Array {
  const curve = new Float32Array(CURVE_LENGTH);
  for (let i = 0; i < CURVE_LENGTH; i++) {
    const x = (i / (CURVE_LENGTH - 1)) * 2 - 1;
    curve[i] = map(x);
  }
  return curve;
}

/** Soft saturation: tanh with drive (0–1 maps to a usable range). */
export function tanhCurve(drive: number): Float32Array {
  const k = 1 + drive * 12;
  return fillSymmetric((x) => Math.tanh(k * x) / Math.tanh(k));
}

/** Hard-clip distortion. */
export function hardClipCurve(drive: number): Float32Array {
  const k = 1 + drive * 8;
  return fillSymmetric((x) => Math.max(-1, Math.min(1, k * x)));
}

/** Foldback: wraps over-threshold samples back in. */
export function foldbackCurve(drive: number): Float32Array {
  const k = 1 + drive * 6;
  return fillSymmetric((x) => {
    let y = k * x;
    while (y > 1 || y < -1) {
      if (y > 1) y = 2 - y;
      else y = -2 - y;
    }
    return y;
  });
}
