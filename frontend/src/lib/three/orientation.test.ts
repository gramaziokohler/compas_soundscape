import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { forwardVector, orientationFromQuaternion, orientationQuaternion, rotateOrientation } from './orientation';

const DEG = Math.PI / 180;

describe('orientationFromQuaternion', () => {
  it('round-trips yaw / pitch / roll', () => {
    const cases = [
      [0, 0, 0],
      [30, 0, 0],
      [-120, 20, 0],
      [45, -60, 15],
      [170, 10, -80],
    ];
    for (const [y, p, r] of cases) {
      const o = orientationFromQuaternion(orientationQuaternion(y * DEG, p * DEG, r * DEG));
      expect(o.yaw).toBeCloseTo(y * DEG, 6);
      expect(o.pitch).toBeCloseTo(p * DEG, 6);
      expect(o.roll).toBeCloseTo(r * DEG, 6);
    }
  });
});

describe('rotateOrientation', () => {
  it('rotating about world +Z by +90° turns yaw 0 (facing -Y) to face +X', () => {
    const o = rotateOrientation({ yaw: 0, pitch: 0, roll: 0 }, new THREE.Vector3(0, 0, 1), 90 * DEG);
    const f = forwardVector(o.yaw, o.pitch);
    expect(f.x).toBeCloseTo(1, 6);
    expect(f.y).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(0, 6);
  });

  it('rotating about world +X tilts a -Y facing source up', () => {
    const o = rotateOrientation({ yaw: 0, pitch: 0, roll: 0 }, new THREE.Vector3(1, 0, 0), -30 * DEG);
    expect(o.pitch).toBeCloseTo(30 * DEG, 6);
    expect(o.yaw).toBeCloseTo(0, 6);
  });
});
