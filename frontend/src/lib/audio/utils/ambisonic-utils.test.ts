import { describe, it, expect } from 'vitest';
import { orientationToRotationMatrix3, toHoaRotatorMatrix3, transposeMatrix3 } from './ambisonic-utils';
import type { Orientation } from '@/types/audio';

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

/**
 * Omnitone's FOARotator as wired in omnitone 1.3: ACN (Y, Z, X) → v = (−Y, Z, −X),
 * out = M·v (M column-major), back with the same sign flips. Directions are AmbiX
 * (X front, Y left, Z up) in the listener's head frame.
 */
function omnitoneRotate(orientation: Orientation, dir: { x: number; y: number; z: number }) {
  const m = orientationToRotationMatrix3(orientation);
  const v = [-dir.y, dir.z, -dir.x];
  const out = [0, 1, 2].map((r) => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
  return { x: -out[2], y: -out[0], z: out[1] };
}

function expectDir(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
}

const FRONT = { x: 1, y: 0, z: 0 };
const LEFT = { x: 0, y: 1, z: 0 };
const RIGHT = { x: 0, y: -1, z: 0 };
const UP = { x: 0, y: 0, z: 1 };
const DOWN = { x: 0, y: 0, z: -1 };
const Q = Math.PI / 2;

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

  // Listener convention: +yaw turns right, +pitch looks up, +roll tilts the head left.
  it('turning right brings a source on the right to the front', () => {
    expectDir(omnitoneRotate({ yaw: Q, pitch: 0, roll: 0 }, RIGHT), FRONT);
    expectDir(omnitoneRotate({ yaw: Q, pitch: 0, roll: 0 }, FRONT), LEFT);
  });

  it('looking up moves a frontal source down', () => {
    expectDir(omnitoneRotate({ yaw: 0, pitch: Q, roll: 0 }, FRONT), DOWN);
    expectDir(omnitoneRotate({ yaw: 0, pitch: Q, roll: 0 }, UP), FRONT);
  });

  it('pitches about the head axis after a yaw', () => {
    // Turned right to face the source, then looking up: the source is below, not beside.
    expectDir(omnitoneRotate({ yaw: Q, pitch: Q, roll: 0 }, RIGHT), DOWN);
  });

  it('tilting the head left puts a source on the left above', () => {
    expectDir(omnitoneRotate({ yaw: 0, pitch: 0, roll: Q }, LEFT), UP);
  });
});

/**
 * First-order block of Omnitone's HOARotator (omnitone 1.3): gains g = [−m0, m1, −m2, −m3, m4,
 * −m5, −m6, m7, −m8], input ACN 1+j → output ACN 1+k through g[j·3 + k].
 */
function hoaRotate(m: readonly number[], dir: { x: number; y: number; z: number }) {
  const g = [-m[0], m[1], -m[2], -m[3], m[4], -m[5], -m[6], m[7], -m[8]];
  const a = [dir.y, dir.z, dir.x];
  const out = [0, 1, 2].map((k) => a[0] * g[k] + a[1] * g[3 + k] + a[2] * g[6 + k]);
  return { x: out[2], y: out[0], z: out[1] };
}

describe('toHoaRotatorMatrix3', () => {
  it('HOARotator given the bare identity mirrors left/right (the measured bug)', () => {
    expectDir(hoaRotate([1, 0, 0, 0, 1, 0, 0, 0, 1], LEFT), RIGHT);
  });

  it('makes HOARotator rotate exactly like FOARotator', () => {
    const orientations: Orientation[] = [
      { yaw: 0, pitch: 0, roll: 0 }, { yaw: Q, pitch: 0, roll: 0 }, { yaw: 0, pitch: Q, roll: 0 },
      { yaw: 0.7, pitch: -0.3, roll: 0.2 }, { yaw: -2.1, pitch: 0.9, roll: -0.6 },
    ];
    for (const o of orientations) {
      for (const dir of [FRONT, LEFT, RIGHT, UP, DOWN]) {
        expectDir(hoaRotate(toHoaRotatorMatrix3(orientationToRotationMatrix3(o)), dir), omnitoneRotate(o, dir));
      }
    }
  });
});
