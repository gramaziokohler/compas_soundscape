import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  analyticalGain,
  nearestBalloonIndex,
  parseBalloon,
  resampleLinear,
  worldToSourceFrame,
  type DirectivityBalloon,
} from './source-directivity';

function encodeBalloon(directions: number[][], irs: number[][], fs = 48000): ArrayBuffer {
  const n = directions.length;
  const taps = irs[0].length;
  const buffer = new ArrayBuffer(16 + 4 * (n * 3 + n * taps));
  const bytes = new Uint8Array(buffer);
  bytes.set([0x44, 0x49, 0x52, 0x42]); // "DIRB"
  const header = new DataView(buffer, 4, 12);
  header.setUint32(0, n, true);
  header.setUint32(4, taps, true);
  header.setUint32(8, fs, true);
  new Float32Array(buffer, 16, n * 3).set(directions.flat());
  new Float32Array(buffer, 16 + 12 * n, n * taps).set(irs.flat());
  return buffer;
}

const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

describe('real-time source directivity', () => {
  it('parses the binary balloon and rejects garbage', () => {
    const balloon = parseBalloon('dir_x', encodeBalloon(axes, axes.map((_, i) => [i, 0, 0, 0])));
    expect(balloon.n).toBe(6);
    expect(balloon.taps).toBe(4);
    expect(balloon.fs).toBe(48000);
    expect(Array.from(balloon.directions.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(balloon.irs[4 * 2]).toBe(2);
    expect(() => parseBalloon('x', new ArrayBuffer(16))).toThrow();
    expect(() => parseBalloon('x', encodeBalloon(axes, axes.map(() => [1])).slice(0, 40))).toThrow();
  });

  it('cardioid-family gain', () => {
    expect(analyticalGain(0.5, 1)).toBe(1);
    expect(analyticalGain(0.5, -1)).toBe(0);
    expect(analyticalGain(1, -1)).toBe(1);
    expect(analyticalGain(0, -1)).toBe(-1); // figure-eight back lobe is phase-inverted
  });

  it('maps the listener direction into the source frame', () => {
    const omniYaw = { id: 'cardioid', yaw: 0, pitch: 0, roll: 0 };
    // yaw 0 faces -Y: a listener at -Y of the source is on-axis (+x in the source frame)
    const front = worldToSourceFrame(new THREE.Vector3(0, -1, 0), omniYaw);
    expect(front.x).toBeCloseTo(1);
    const behind = worldToSourceFrame(new THREE.Vector3(0, 1, 0), omniYaw);
    expect(behind.x).toBeCloseTo(-1);
    // listener at +X of the source is to the source's left (+y) at yaw 0
    const left = worldToSourceFrame(new THREE.Vector3(1, 0, 0), omniYaw);
    expect(left.y).toBeCloseTo(1);
    // yaw = -90 deg turns the front toward +X
    const turned = worldToSourceFrame(new THREE.Vector3(1, 0, 0), { ...omniYaw, yaw: -Math.PI / 2 });
    expect(turned.x).toBeCloseTo(1);
  });

  it('picks the nearest balloon direction', () => {
    const balloon: DirectivityBalloon = {
      id: 'b', n: 6, taps: 1, fs: 48000, directions: new Float32Array(axes.flat()), irs: new Float32Array(6),
    };
    expect(nearestBalloonIndex(balloon, new THREE.Vector3(0.9, 0.1, 0).normalize())).toBe(0);
    expect(nearestBalloonIndex(balloon, new THREE.Vector3(0, -0.2, -0.9).normalize())).toBe(5);
  });

  it('resamples short impulse responses linearly', () => {
    const src = new Float32Array([0, 1, 0, 0]);
    expect(resampleLinear(src, 48000, 48000)).toBe(src);
    const out = resampleLinear(src, 44100, 48000);
    expect(out.length).toBe(4);
    expect(Math.max(...out)).toBeGreaterThan(0.8);
  });
});
