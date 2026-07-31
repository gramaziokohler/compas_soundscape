/**
 * Ambisonic post-render buffer rotation.
 *
 * Applies a Wigner-D rotation to a raw ambisonic AudioBuffer.
 * Used by SoundscapeExporter for AmbisonicIR raw ambisonic exports
 * when the listener has a non-identity orientation.
 *
 * ACN 0 (W) is rotation-invariant and copied unchanged.
 * Each higher-order band is multiplied by its Wigner-D sub-matrix.
 */

import type { AmbisonicOrder, Orientation } from '@/types/audio';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sht = require('spherical-harmonic-transform') as {
  getSHrotMtx: (R: number[][], order: number) => number[][];
  yawPitchRoll2Rzyx: (yaw: number, pitch: number, roll: number) => number[][];
};

export function applyAmbisonicRotation(
  buffer: AudioBuffer,
  order: AmbisonicOrder,
  orientation: Orientation,
): AudioBuffer {
  // Convert yaw/pitch/roll to 3×3 rotation matrix (ZYX convention)
  const Rzyx = sht.yawPitchRoll2Rzyx(orientation.yaw, orientation.pitch, orientation.roll ?? 0);

  // Compute block-diagonal Wigner D-matrix for the given order
  const rotMtx = sht.getSHrotMtx(Rzyx, order);

  const numChannels = (order + 1) ** 2;
  const outputBuffer = new AudioBuffer({
    numberOfChannels: numChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  });

  // ACN 0 (W) — copy unchanged (0th-order SH is rotation-invariant)
  outputBuffer.getChannelData(0).set(buffer.getChannelData(0));

  // Rotate each higher-order band
  let bandStart = 1;
  for (let n = 1; n <= order; n++) {
    const bandSize = 2 * n + 1;
    for (let out = 0; out < bandSize; out++) {
      const outCh = bandStart + out;
      const outData = outputBuffer.getChannelData(outCh);
      for (let in_ = 0; in_ < bandSize; in_++) {
        const inCh = bandStart + in_;
        const inputData = buffer.getChannelData(inCh);
        const gain = rotMtx[outCh][inCh];
        if (in_ === 0) {
          for (let i = 0; i < buffer.length; i++) outData[i] = gain * inputData[i];
        } else {
          for (let i = 0; i < buffer.length; i++) outData[i] += gain * inputData[i];
        }
      }
    }
    bandStart += bandSize;
  }

  return outputBuffer;
}
