import { describe, it, expect } from 'vitest';
import { decodeAudioAllChannels, readWavHeader } from './wav-multichannel';

/** Interleaved IEEE-float WAV (format 3, as scipy writes it). */
function floatWav(channels: number[][], sampleRate = 48000): ArrayBuffer {
  const n = channels[0].length;
  const nCh = channels.length;
  const dataBytes = n * nCh * 4;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 4, true);
  v.setUint16(32, nCh * 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) v.setFloat32(44 + (i * nCh + c) * 4, channels[c][i], true);
  return buf;
}

/** Minimal context: createBuffer only; decodeAudioData keeps 8 channels like Chrome. */
function fakeContext() {
  const createBuffer = (numberOfChannels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return { numberOfChannels, length, sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
  };
  return {
    createBuffer,
    decodeAudioData: async () => createBuffer(8, 2, 48000),
  } as unknown as BaseAudioContext;
}

describe('wav-multichannel', () => {
  const channels = Array.from({ length: 16 }, (_, c) => [c / 16, -c / 32]);

  it('reads the header of a 16-channel float WAV', () => {
    const h = readWavHeader(floatWav(channels));
    expect(h).toMatchObject({ formatTag: 3, numberOfChannels: 16, sampleRate: 48000, bitsPerSample: 32, dataOffset: 44 });
  });

  it('keeps all 16 channels of a third-order IR', async () => {
    const out = await decodeAudioAllChannels(fakeContext(), floatWav(channels));
    expect(out.numberOfChannels).toBe(16);
    expect(out.length).toBe(2);
    channels.forEach((ch, c) => {
      expect(out.getChannelData(c)[0]).toBeCloseTo(ch[0]);
      expect(out.getChannelData(c)[1]).toBeCloseTo(ch[1]);
    });
  });
});
