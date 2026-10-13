import { describe, it, expect } from 'vitest';
import {
  applySn3dToEncoder,
  n3dToSn3dGain,
  orientationToRotationMatrix3,
  transposeMatrix3,
} from './ambisonic-utils';

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

describe('n3dToSn3dGain', () => {
  it('leaves W untouched and scales order n by 1/√(2n+1)', () => {
    expect(n3dToSn3dGain(0)).toBe(1);
    [1, 2, 3].forEach((acn) => expect(n3dToSn3dGain(acn)).toBeCloseTo(1 / Math.sqrt(3)));
    [4, 8].forEach((acn) => expect(n3dToSn3dGain(acn)).toBeCloseTo(1 / Math.sqrt(5)));
    [9, 15].forEach((acn) => expect(n3dToSn3dGain(acn)).toBeCloseTo(1 / Math.sqrt(7)));
  });
});

describe('applySn3dToEncoder', () => {
  it('turns N3D front-source gains into SN3D (W equals X)', () => {
    // N3D gains for a source straight ahead at first order: W=1, Y=0, Z=0, X=√3
    const values = [1, 0, 0, Math.sqrt(3)];
    const encoder = { gainNodes: values.map((v) => ({ gain: { value: v } }) as unknown as GainNode) };
    applySn3dToEncoder(encoder);
    const gains = encoder.gainNodes.map((g) => g.gain.value);
    expect(gains[0]).toBe(1);
    expect(gains[3]).toBeCloseTo(1);
  });
});

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
