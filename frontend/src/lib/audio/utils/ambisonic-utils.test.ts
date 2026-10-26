import { describe, it, expect } from 'vitest';
import { orientationToRotationMatrix3, transposeMatrix3 } from './ambisonic-utils';

/** Column-major 3×3 product a·b. */
function multiply3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 3; k++) {
        out[col * 3 + row] += a[k * 3 + row] * b[col * 3 + k];
      }
    }
  }
  return out;
}

describe('orientationToRotationMatrix3', () => {
  it('is the identity at rest', () => {
    const m = orientationToRotationMatrix3({ yaw: 0, pitch: 0, roll: 0 });
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v));
  });

  it('is orthonormal, so its transpose undoes it', () => {
    const m = orientationToRotationMatrix3({ yaw: 0.7, pitch: -0.3, roll: 0.2 });
    const product = multiply3(transposeMatrix3(m), m);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(product[i]).toBeCloseTo(v));
  });
});
